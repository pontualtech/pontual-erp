/**
 * Rede Card Provider — Integration placeholder
 *
 * API Docs: https://www.userede.com.br/desenvolvedores
 *
 * Future features:
 * - Automatic transaction reconciliation
 * - Real-time fee calculation from Rede API
 * - Anticipation request via API
 * - Settlement reports
 *
 * Rede config is stored in the Settings table with keys:
 * - rede.pv        — Ponto de Venda (merchant ID)
 * - rede.token     — API authentication token
 * - rede.environment — 'sandbox' | 'production'
 */

export interface RedeConfig {
  pv: string // Ponto de Venda (merchant ID)
  token: string // API token
  environment: 'sandbox' | 'production'
}

export interface RedeTransaction {
  tid: string
  nsu: string
  amount: number // cents
  installments: number
  authorization_code: string
  status: string
  card_brand: string
  captured_at: string
}

// Placeholder functions for future implementation

export async function getRedeConfig(
  companyId: string
): Promise<RedeConfig | null> {
  // TODO: Read from settings table (key: rede.pv, rede.token, rede.environment)
  void companyId
  return null
}

export async function fetchRedeTransactions(
  config: RedeConfig,
  dateFrom: string,
  dateTo: string
): Promise<RedeTransaction[]> {
  // TODO: GET https://api.userede.com.br/erede/v1/transactions
  // Headers: Authorization: Bearer {token}, Content-Type: application/json
  void config
  void dateFrom
  void dateTo
  throw new Error('Rede API integration not implemented yet')
}

export async function requestAnticipation(
  config: RedeConfig,
  transactionIds: string[]
): Promise<{ success: boolean; anticipated_amount: number }> {
  // TODO: POST https://api.userede.com.br/erede/v1/anticipation
  void config
  void transactionIds
  throw new Error('Rede API anticipation not implemented yet')
}
