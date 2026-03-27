/**
 * Boleto integration types
 * Adapter pattern for multi-bank boleto generation
 */

export interface BoletoInput {
  amount: number // centavos
  dueDate: string // YYYY-MM-DD
  customerName: string
  customerDocument: string // CPF or CNPJ
  description: string
  receivableId?: string
}

export interface BoletoResult {
  success: boolean
  nossoNumero: string
  barcode: string
  digitableLine: string
  boletoUrl?: string // PDF URL if available
  pixCode?: string // PIX copia-e-cola if available
}

export interface BoletoStatus {
  nossoNumero: string
  status: 'REGISTERED' | 'PAID' | 'OVERDUE' | 'CANCELLED'
  paidAmount?: number
  paidDate?: string
}

export interface BoletoProvider {
  name: string
  generateBoleto(input: BoletoInput): Promise<BoletoResult>
  checkStatus(nossoNumero: string): Promise<BoletoStatus>
  cancelBoleto(nossoNumero: string): Promise<void>
}

/** Boleto record stored in DB (via AccountReceivable metadata or separate tracking) */
export interface BoletoRecord {
  id: string
  receivableId: string
  provider: string
  nossoNumero: string
  barcode: string
  digitableLine: string
  boletoUrl: string | null
  pixCode: string | null
  status: 'REGISTERED' | 'PAID' | 'OVERDUE' | 'CANCELLED'
  amount: number
  dueDate: string
  customerName: string
  customerDocument: string
  paidAmount: number | null
  paidDate: string | null
  createdAt: string
  updatedAt: string
}
