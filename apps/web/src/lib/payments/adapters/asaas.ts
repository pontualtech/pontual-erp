import type { PaymentProvider, PixCharge, PaymentStatus, WebhookPayload } from '../types'
import { createHmac } from 'crypto'

const ASAAS_API_URL = () => process.env.ASAAS_API_URL || 'https://sandbox.asaas.com/api/v3'
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

  private async findOrCreateCustomer(name: string, document: string) {
    // Try to find existing
    const search = await this.request('GET', `/customers?cpfCnpj=${document}`)
    if (search.data?.length > 0) {
      return search.data[0]
    }

    // Create new
    return this.request('POST', '/customers', {
      name,
      cpfCnpj: document,
    })
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
      paidAt: charge.confirmedDate ? new Date(charge.confirmedDate) : undefined,
    }
  }

  validateWebhook(headers: Record<string, string>, body: string): boolean {
    const token = ASAAS_WEBHOOK_TOKEN()
    if (!token) return true // No token configured = skip validation

    const receivedToken = headers['asaas-access-token'] || headers['x-asaas-access-token']
    if (!receivedToken) return false

    return receivedToken === token
  }

  parseWebhook(body: string): WebhookPayload {
    const data = JSON.parse(body)
    const payment = data.payment || data

    return {
      externalId: payment.id,
      status: payment.status === 'RECEIVED' || payment.status === 'CONFIRMED' ? 'CONFIRMED' : payment.status,
      paidAt: payment.confirmedDate || undefined,
    }
  }
}
