import { timingSafeEqual } from 'crypto'
import type { PaymentProvider, PixCharge, PaymentStatus, WebhookPayload, Charge, CreateChargeParams, PaymentFee, BillingType } from '../types'

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

  /**
   * Busca taxas vinculadas a 1 payment. O endpoint /financialTransactions
   * do Asaas v3 NAO respeita filtro `?paymentId=` ou `?payment=` no query
   * (testado: retorna toda a conta independente). Solucao: buscar pagina
   * por pagina e filtrar local pelo campo `paymentId` retornado em cada
   * item. Cada item tem: { paymentId, type, value, date, description }.
   *
   * Limite: ate 5 paginas (500 transacoes recentes). Webhook chega logo
   * apos pagamento, entao as fees relevantes ficam no topo do extrato.
   *
   * Ref: https://docs.asaas.com/reference/listar-extrato
   */
  async getFeesForPayment(externalId: string): Promise<PaymentFee[]> {
    const matches: any[] = []
    try {
      const pageSize = 100
      for (let page = 0; page < 5; page++) {
        const offset = page * pageSize
        const data = await this.request('GET', `/financialTransactions?limit=${pageSize}&offset=${offset}`)
        const items = (data?.data || []) as any[]
        if (items.length === 0) break
        for (const t of items) {
          if (t.paymentId === externalId) matches.push(t)
        }
        // Otimizacao: se ja achei e a pagina seguinte e mais antiga que
        // a transacao mais recente vinculada, posso parar
        if (matches.length > 0 && items.length < pageSize) break
        if (!data?.hasMore) break
      }
      const fees: PaymentFee[] = []
      for (const t of matches) {
        const fee = mapAsaasTransactionToFee(t)
        if (fee && fee.amount > 0) fees.push(fee)
      }
      return fees
    } catch (err) {
      console.error('[Asaas] getFeesForPayment failed', { externalId, err: err instanceof Error ? err.message : err })
      return []
    }
  }
}

/**
 * Mapeia 1 entrada de FinancialTransaction do Asaas pra PaymentFee.
 * Retorna null pra entradas que nao sao taxa (ex: PAYMENT_RECEIVED).
 *
 * Tipos comuns Asaas:
 *  - PAYMENT_FEE             → taxa do meio de pagamento (PIX/Boleto/Cartao)
 *  - PAYMENT_DUNNING_RECEIVED → recebimento (entrada, ignorar)
 *  - ASAAS_FEE_REVERSAL      → estorno de taxa (ignorar — vira saldo positivo)
 *  - NOTIFICATION_FEE        → notificacao SMS/email
 *  - PAYMENT_FEE_REVERSAL    → estorno (ignorar)
 *  - ANTICIPATION_FEE        → taxa de antecipacao
 *  - CHARGEBACK_FEE          → taxa de chargeback
 */
function mapAsaasTransactionToFee(t: any): PaymentFee | null {
  const type = String(t.type || '').toUpperCase()
  const desc = String(t.description || '')
  const value = Math.abs(Number(t.value || 0))
  if (value === 0) return null

  // Ignora entradas e estornos (nao sao despesa)
  if (type === 'PAYMENT_RECEIVED' || type === 'PAYMENT_DUNNING_RECEIVED' || type === 'TRANSFER') return null
  if (type.includes('REVERSAL') || type.includes('REFUND')) return null
  // Asaas as vezes manda value positivo pra entrada — confere se a transacao e despesa
  if (Number(t.value) > 0 && !type.includes('FEE')) return null

  const amount = Math.round(value * 100) // centavos
  const occurredAt = new Date(t.date || t.createdAt || Date.now())

  // Notificacoes — SMS/email/whatsapp cobrados pelo gateway.
  // PT-BR Asaas usa "mensageria" pra agregar SMS/email/notificacoes.
  // Tipos especificos descobertos:
  //   - PAYMENT_MESSAGING_NOTIFICATION_FEE (Asaas v3)
  //   - NOTIFICATION_FEE (legacy)
  if (
    type === 'NOTIFICATION_FEE' ||
    type === 'PAYMENT_MESSAGING_NOTIFICATION_FEE' ||
    /messag|notif/i.test(type) ||
    /notif|mensag|sms|email|whatsapp/i.test(desc)
  ) {
    return { type: 'NOTIFICATION', description: desc || 'Notificacao/Mensageria', amount, occurredAt }
  }

  // Taxa principal (transacao)
  if (type === 'PAYMENT_FEE' || type === 'BANK_SLIP_FEE' || type === 'PIX_FEE' || /fee/i.test(type) || /taxa/i.test(desc)) {
    let billingType: BillingType | undefined
    const lower = desc.toLowerCase()
    if (lower.includes('pix')) billingType = 'PIX'
    else if (lower.includes('boleto') || lower.includes('bank slip')) billingType = 'BOLETO'
    else if (lower.includes('cart') || lower.includes('credit')) billingType = 'CREDIT_CARD'
    return { type: 'TRANSACTION', billingType, description: desc || 'Taxa de transacao', amount, occurredAt }
  }

  // Outras taxas
  return { type: 'OTHER', description: desc || type, amount, occurredAt }
}
