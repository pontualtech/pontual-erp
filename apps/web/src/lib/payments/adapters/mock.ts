import type { PaymentProvider, PixCharge, PaymentStatus, WebhookPayload } from '../types'

/**
 * Mock payment provider for development/testing.
 * Simulates PIX payment flow without real gateway.
 */
export class MockProvider implements PaymentProvider {
  name = 'mock'

  async createPixCharge(params: {
    amount: number
    customerName: string
    customerDocument: string
    description: string
    idempotencyKey: string
    expiresInMinutes?: number
  }): Promise<PixCharge> {
    const externalId = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const expiresAt = new Date(Date.now() + (params.expiresInMinutes || 30) * 60 * 1000)

    // Simulated PIX copia-e-cola
    const qrCode = `00020126580014br.gov.bcb.pix0136${externalId}5204000053039865404${(params.amount / 100).toFixed(2)}5802BR5925${params.customerName.slice(0, 25)}6009SAO PAULO62070503***6304`

    return {
      externalId,
      qrCode,
      qrCodeImage: undefined,
      amount: params.amount,
      expiresAt,
    }
  }

  async getStatus(externalId: string): Promise<PaymentStatus> {
    // Mock: auto-confirm after checking (simulates sandbox)
    return {
      externalId,
      status: 'PENDING',
    }
  }

  validateWebhook(): boolean {
    return true
  }

  parseWebhook(body: string): WebhookPayload {
    const data = JSON.parse(body)
    return {
      externalId: data.externalId || data.id,
      status: data.status || 'CONFIRMED',
      paidAt: new Date().toISOString(),
    }
  }
}
