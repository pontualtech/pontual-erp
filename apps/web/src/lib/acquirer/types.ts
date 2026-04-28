/**
 * Tipos compartilhados do modulo de conciliacao de cartao presencial.
 *
 * Provider-agnostic: cada adquirente (Rede, Cielo, Stone, ...) tem seu
 * proprio adapter que mapeia o formato dela pra `ParsedAcquirerTransaction`.
 */

export type AcquirerName = 'rede' | 'cielo' | 'stone' | 'getnet' | 'safrapay'

/**
 * Output do parser de extrato — uma transacao normalizada pronta pra
 * gravar em `acquirer_transactions`. Todas as quantias em CENTAVOS.
 */
export interface ParsedAcquirerTransaction {
  acquirer: AcquirerName
  externalId: string         // NSU/CV — unico por adquirente
  authorizationCode?: string
  cardBrand?: string         // 'mastercard' | 'visa' | 'elo' | ...
  cardLast4?: string
  cardMasked?: string        // '522840******9163'
  holderName?: string        // raramente disponivel
  modality?: 'credit' | 'debit'
  installments: number
  grossAmount: number        // centavos
  netAmount: number          // centavos
  mdrFeeAmount: number
  mdrFeePercent: number
  anticipationFeeAmount: number
  anticipationFeePercent: number
  totalFeeAmount: number
  transactionDate: Date
  transactionTime?: string   // 'HH:MM:SS'
  expectedCreditDate?: Date
  terminalCode?: string      // 'SD130361'
  status: 'APPROVED' | 'CANCELLED' | 'CHARGEBACK' | 'EXPIRED'
  rawData: Record<string, any>
}

/**
 * Resultado do import de um arquivo de extrato.
 */
export interface ImportResult {
  acquirer: AcquirerName
  total_rows: number
  parsed: number
  skipped: number  // pix/cancelado/duplicado/etc
  inserted: number
  duplicates: number  // ja existiam (mesmo external_id)
  errors: Array<{ row: number; error: string }>
}

/**
 * Interface que cada parser de adquirente deve implementar.
 */
export interface AcquirerStatementParser {
  acquirer: AcquirerName
  /**
   * Detecta se o conteudo bate com o formato dessa adquirente.
   * Util pra auto-detectar quando user faz upload sem dizer qual e.
   */
  matches(text: string): boolean
  /**
   * Parseia o texto inteiro do arquivo e retorna transacoes normalizadas.
   * Erros por linha vao em ImportResult.errors.
   */
  parse(text: string): { transactions: ParsedAcquirerTransaction[]; errors: Array<{ row: number; error: string }> }
}
