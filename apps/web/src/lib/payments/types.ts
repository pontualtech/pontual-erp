export interface PixCharge {
  externalId: string
  qrCode: string        // PIX copia-e-cola
  qrCodeImage?: string  // base64 QR image
  amount: number        // centavos
  expiresAt: Date
}

export interface PaymentStatus {
  externalId: string
  status: 'PENDING' | 'CONFIRMED' | 'EXPIRED' | 'REFUNDED' | 'FAILED'
  paidAt?: Date
}

export interface WebhookPayload {
  externalId: string
  status: string
  paidAt?: string
  [key: string]: unknown
}

export interface PaymentProvider {
  name: string

  createPixCharge(params: {
    amount: number          // centavos
    customerName: string
    customerDocument: string
    description: string
    idempotencyKey: string
    expiresInMinutes?: number
  }): Promise<PixCharge>

  getStatus(externalId: string): Promise<PaymentStatus>

  validateWebhook(headers: Record<string, string>, body: string): boolean

  parseWebhook(body: string): WebhookPayload
}
