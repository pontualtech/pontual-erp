import { timingSafeEqual } from 'crypto'
import type { PaymentProvider, PixCharge, PaymentStatus, WebhookPayload, Charge, CreateChargeParams } from '../types'

const ENV_API_URL = () => process.env.ASAAS_API_URL || 'https://api-sandbox.asaas.com/v3'
const ENV_API_KEY = () => process.env.ASAAS_API_KEY || ''
const ENV_WEBHOOK_TOKEN = () => process.env.ASAAS_WEBHOOK_TOKEN || ''

/**
 * Config opcional por conta bancaria — permite multiplas contas Asaas
 * rodando em paralelo (ex: Asaas PontualTech + Asaas Imprimitech).
 * Quando nao informada, usa o env global (retrocompativel).
 */
export type AsaasConfig = {
  apiKey?: string
  apiUrl?: string
  webhookToken?: string
}

export class AsaasProvider implements PaymentProvider {
  name = 'asaas'
  private readonly config: AsaasConfig

  constructor(config?: AsaasConfig) {
    this.config = config || {}
  }

  private apiKey(): string { return this.config.apiKey || ENV_API_KEY() }
  private apiUrl(): string { return this.config.apiUrl || ENV_API_URL() }
  private webhookToken(): string { return this.config.webhookToken || ENV_WEBHOOK_TOKEN() }

  private async request(method: string, path: string, body?: unknown) {
    const url = `${this.apiUrl()}${path}`
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'access_token': this.apiKey(),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { errors?: Array<{ description?: string }>; message?: string }
      const detail = err.errors?.[0]?.description || err.message || ''
      console.error('[Asaas API Error]', { status: res.status, path, err })
      throw new Error(detail ? `Asaas: ${detail}` : `Asaas API error: ${res.status}`)
    }

    return res.json()
  }

  async createPixCharge(params: {
    amount: number
    customerName: string
    customerDocument: string
    customerEmail?: string
    customerPhone?: string
    description: string
    idempotencyKey: string
    expiresInMinutes?: number
  }): Promise<PixCharge> {
    // First, find or create customer in Asaas (com email/phone pra Asaas notificar)
    const customerData = await this.findOrCreateCustomer(
      params.customerName,
      params.customerDocument,
      params.customerEmail,
      params.customerPhone,
    )

    // Create PIX charge
    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + 1) // next day

    const charge = await this.request('POST', '/payments', {
      customer: customerData.id,
      billingType: 'PIX',
      value: params.amount / 100, // Asaas uses reais, not centavos
      dueDate: dueDate.toISOString().split('T')[0],
      description: params.description,
      externalReference: params.idempotencyKey,
    })

    // Get PIX QR code
    const pixData = await this.request('GET', `/payments/${charge.id}/pixQrCode`)

    const expiresAt = new Date(Date.now() + (params.expiresInMinutes || 30) * 60 * 1000)

    return {
      externalId: charge.id,
      qrCode: pixData.payload || '',
      qrCodeImage: pixData.encodedImage ? `data:image/png;base64,${pixData.encodedImage}` : undefined,
      amount: params.amount,
      expiresAt,
    }
  }

  async createCharge(params: CreateChargeParams): Promise<Charge> {
    const customerData = await this.findOrCreateCustomer(
      params.customerName,
      params.customerDocument,
      params.customerEmail,
      params.customerPhone,
    )

    // Asaas rejects past due dates — use tomorrow as minimum
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStr = tomorrow.toISOString().split('T')[0]

    let dueDate = params.dueDate || tomorrowStr
    if (dueDate < tomorrowStr) dueDate = tomorrowStr

    const payload: Record<string, unknown> = {
      customer: customerData.id,
      billingType: params.billingType,
      value: params.amount / 100,
      dueDate,
      description: params.description,
    }

    // Parcelamento só para cartão de crédito
    if (params.billingType === 'CREDIT_CARD' && params.installmentCount && params.installmentCount > 1) {
      payload.installmentCount = params.installmentCount
      payload.installmentValue = Math.round(params.amount / params.installmentCount) / 100
    }

    const charge = await this.request('POST', '/payments', payload)

    const result: Charge = {
      externalId: charge.id,
      billingType: params.billingType,
      amount: params.amount,
      status: charge.status,
      invoiceUrl: charge.invoiceUrl || '',
      dueDate,
    }

    if (charge.bankSlipUrl) {
      result.bankSlipUrl = charge.bankSlipUrl
    }

    // Para PIX, buscar QR code
    if (params.billingType === 'PIX') {
      try {
        const pixData = await this.request('GET', `/payments/${charge.id}/pixQrCode`)
        result.pixQrCode = pixData.payload || ''
        result.pixQrCodeImage = pixData.encodedImage
          ? `data:image/png;base64,${pixData.encodedImage}`
          : undefined
      } catch (err) {
        console.warn('[Asaas] Failed to get PIX QR code:', err)
      }
    }

    return result
  }

  /**
   * Sanitiza telefone pra formato esperado pelo Asaas:
   *  - mobilePhone: 11 digitos sem nada (51986123456 / 5511986123456)
   *  - aceita string com mascara, devolve so digitos
   * Retorna null se for vazio/invalido.
   */
  private sanitizePhone(raw: string | undefined | null): string | null {
    if (!raw) return null
    const digits = raw.replace(/\D/g, '')
    // Asaas BR: aceita 10 (fixo) ou 11 (celular) digitos. Com 12-13 (DDI 55), tira o 55.
    if (digits.length === 12 || digits.length === 13) {
      return digits.slice(-11)
    }
    if (digits.length >= 10 && digits.length <= 11) return digits
    return null
  }

  private async findOrCreateCustomer(name: string, document: string, email?: string, phone?: string) {
    const cleanPhone = this.sanitizePhone(phone)
    const desired: Record<string, string> = { name, cpfCnpj: document }
    if (email) desired.email = email
    if (cleanPhone) desired.mobilePhone = cleanPhone

    // Try to find existing by CPF/CNPJ
    const search = await this.request('GET', `/customers?cpfCnpj=${document}`)
    const existing = search.data?.[0]

    if (existing) {
      // Atualiza se algum dado mudou (email/phone) — customers antigos
      // criados sem email/phone passam a receber notificacoes do Asaas
      const needsUpdate = (
        (email && existing.email !== email) ||
        (cleanPhone && existing.mobilePhone !== cleanPhone) ||
        (name && existing.name !== name)
      )
      if (needsUpdate) {
        try {
          return await this.request('POST', `/customers/${existing.id}`, desired)
        } catch (e) {
          console.warn('[Asaas] customer update failed, using existing', e)
          return existing
        }
      }
      return existing
    }

    // Create new
    return this.request('POST', '/customers', desired)
  }

  async getStatus(externalId: string): Promise<PaymentStatus> {
    const charge = await this.request('GET', `/payments/${externalId}`)

    const statusMap: Record<string, PaymentStatus['status']> = {
      PENDING: 'PENDING',
      RECEIVED: 'CONFIRMED',
      CONFIRMED: 'CONFIRMED',
      OVERDUE: 'EXPIRED',
      REFUNDED: 'REFUNDED',
      REFUND_REQUESTED: 'REFUNDED',
      REFUND_IN_PROGRESS: 'REFUNDED',
    }

    return {
      externalId,
      status: statusMap[charge.status] || 'FAILED',
      paidAt: (charge.paymentDate || charge.confirmedDate) ? new Date(charge.paymentDate || charge.confirmedDate) : undefined,
    }
  }

  validateWebhook(headers: Record<string, string>, body: string): boolean {
    const token = this.webhookToken()
    if (!token) {
      console.error('[Asaas] webhook token not configured — rejecting webhook for security')
      return false
    }

    const receivedToken = headers['asaas-access-token'] || headers['x-asaas-access-token']
    if (!receivedToken) return false

    try {
      const a = Buffer.from(receivedToken)
      const b = Buffer.from(token)
      return a.length === b.length && timingSafeEqual(a, b)
    } catch {
      return false
    }
  }

  async cancelCharge(externalId: string): Promise<void> {
    await this.request('DELETE', `/payments/${externalId}`)
  }

  parseWebhook(body: string): WebhookPayload {
    const data = JSON.parse(body)
    const payment = data.payment || data

    const isConfirmed = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(payment.status)

    return {
      externalId: payment.id,
      status: isConfirmed ? 'CONFIRMED' : payment.status,
      paidAt: payment.paymentDate || payment.confirmedDate || payment.clientPaymentDate || undefined,
    }
  }
}
