import { timingSafeEqual } from 'crypto'
import type { PaymentProvider, PixCharge, PaymentStatus, WebhookPayload, Charge, CreateChargeParams } from '../types'

const ASAAS_API_URL = () => process.env.ASAAS_API_URL || 'https://api-sandbox.asaas.com/v3'
const ASAAS_API_KEY = () => process.env.ASAAS_API_KEY || ''
const ASAAS_WEBHOOK_TOKEN = () => process.env.ASAAS_WEBHOOK_TOKEN || ''

export class AsaasProvider implements PaymentProvider {
  name = 'asaas'

  private async request(method: string, path: string, body?: unknown) {
    const url = `${ASAAS_API_URL()}${path}`
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'access_token': ASAAS_API_KEY(),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      console.error('[Asaas API Error]', { status: res.status, path, err })
      throw new Error(`Asaas API error: ${res.status}`)
    }

    return res.json()
  }

  async createPixCharge(params: {
    amount: number
    customerName: string
    customerDocument: string
    description: string
    idempotencyKey: string
    expiresInMinutes?: number
  }): Promise<PixCharge> {
    // First, find or create customer in Asaas
    const customerData = await this.findOrCreateCustomer(
      params.customerName,
      params.customerDocument
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
      params.customerEmail
    )

    const dueDate = params.dueDate || (() => {
      const d = new Date()
      d.setDate(d.getDate() + 1)
      return d.toISOString().split('T')[0]
    })()

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

  private async findOrCreateCustomer(name: string, document: string, email?: string) {
    // Try to find existing
    const search = await this.request('GET', `/customers?cpfCnpj=${document}`)
    if (search.data?.length > 0) {
      return search.data[0]
    }

    // Create new
    const body: Record<string, string> = { name, cpfCnpj: document }
    if (email) body.email = email
    return this.request('POST', '/customers', body)
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
    const token = ASAAS_WEBHOOK_TOKEN()
    if (!token) {
      console.error('[Asaas] ASAAS_WEBHOOK_TOKEN not configured — rejecting webhook for security')
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
