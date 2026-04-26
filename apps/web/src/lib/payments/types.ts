export type BillingType = 'PIX' | 'BOLETO' | 'CREDIT_CARD'

export interface PixCharge {
  externalId: string
  qrCode: string        // PIX copia-e-cola
  qrCodeImage?: string  // base64 QR image
  amount: number        // centavos
  expiresAt: Date
}

export interface Charge {
  externalId: string
  billingType: BillingType
  amount: number          // centavos
  status: string
  invoiceUrl: string      // link de pagamento universal do Asaas
  bankSlipUrl?: string    // PDF do boleto (só BOLETO)
  pixQrCode?: string      // PIX copia-e-cola (só PIX)
  pixQrCodeImage?: string // base64 QR image (só PIX)
  dueDate: string         // YYYY-MM-DD
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

export interface CreateChargeParams {
  billingType: BillingType
  amount: number          // centavos
  customerName: string
  customerDocument: string
  customerEmail?: string
  customerPhone?: string  // celular E.164 (5511999999999) — Asaas usa pra notificar
  description: string
  dueDate?: string        // YYYY-MM-DD (default: tomorrow)
  installmentCount?: number // só CREDIT_CARD (2-12)
}

export interface PaymentProvider {
  name: string

  createPixCharge(params: {
    amount: number          // centavos
    customerName: string
    customerDocument: string
    customerEmail?: string  // pra Asaas notificar
    customerPhone?: string  // celular E.164 (5511999999999)
    description: string
    idempotencyKey: string
    expiresInMinutes?: number
  }): Promise<PixCharge>

  createCharge(params: CreateChargeParams): Promise<Charge>

  getStatus(externalId: string): Promise<PaymentStatus>

  validateWebhook(headers: Record<string, string>, body: string): boolean

  parseWebhook(body: string): WebhookPayload
}
