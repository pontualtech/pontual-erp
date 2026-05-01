/**
 * Cliente da API "Gestão de Vendas" da Rede (Itaú).
 *
 * URLs:
 *   Sandbox antiga: https://rl7-sandbox-api.useredecloud.com.br
 *   Sandbox nova:   https://payments-apisandbox.useredecloud.com.br
 *   Produção:       https://api.userede.com.br/redelabs
 *
 * Auth: OAuth 2.0 Bearer.
 *  POST {OAUTH_PATH} (default: /oauth/token)
 *  Body: client_id + client_secret + grant_type=client_credentials
 *  → { access_token, token_type, expires_in }
 *
 * Endpoints relevantes (todos GET, com Bearer):
 *  /merchant-statement/v1/sales              — Consultar Vendas
 *  /merchant-statement/v1/sales/{cn}/daily   — Consultar Vendas por NSU
 *  /merchant-statement/v1/sales/installments — Parcelas
 *  /merchant-statement/v1/payments           — Pagamentos (taxa de antecipacao vem aqui)
 *  /merchant-statement/v1/receivables/...    — Recebiveis
 *
 * Cache do access_token em memoria (expira via expires_in).
 *
 * Env vars:
 *  REDE_API_URL          — base URL (default sandbox nova)
 *  REDE_CLIENT_ID        — clientId do projeto
 *  REDE_CLIENT_SECRET    — clientSecret
 *  REDE_OAUTH_PATH       — path do token (default /oauth/token)
 *  REDE_PARENT_COMPANY_NUMBER — PV principal (PontualTech: 80361242 em prod;
 *                              em sandbox usa 13381369 ou 22523510)
 */

import type { ParsedAcquirerTransaction } from './types'
import { toCents } from './rede-parser'

interface OAuthToken {
  access_token: string
  token_type: string
  expires_at: number  // epoch ms
}

interface RedeSale {
  merchant?: { companyNumber?: string; documentNumber?: string; companyName?: string; tradeName?: string }
  brandCode?: number
  authorizationCode?: number
  nsu?: number | string
  saleSummaryNumber?: number
  saleDate?: string  // YYYY-MM-DD
  saleHour?: string  // HH:mm:ss
  status?: string
  deviceType?: string
  device?: string
  amount?: number
  mdrFee?: number
  mdrAmount?: number
  discountAmount?: number
  netAmount?: number
  cardNumber?: string
  modality?: { type?: string; code?: number; product?: string; productCode?: number }
  installmentQuantity?: number
}

interface RedeSalesResponse {
  content?: { transactions?: RedeSale[] }
  cursor?: { nextKey?: string; hasNextKey?: boolean }
}

const BRAND_CODE_TO_NAME: Record<number, string> = {
  1: 'mastercard', 2: 'visa', 3: 'diners', 4: 'cabal', 5: 'sicred',
  6: 'sorocred', 7: 'hipercard', 8: 'cup', 13: 'amex', 14: 'elo',
  15: 'hiper', 16: 'alelo', 20: 'sodexo', 21: 'vr', 52: 'ticket',
  76: 'jcb', 77: 'credz', 999: 'outros',
}

export class RedeApiClient {
  private apiUrl: string
  private clientId: string
  private clientSecret: string
  private oauthPath: string
  private tokenCache: OAuthToken | null = null

  constructor(opts?: { apiUrl?: string; clientId?: string; clientSecret?: string; oauthPath?: string }) {
    this.apiUrl = opts?.apiUrl
      || process.env.REDE_API_URL
      || 'https://payments-apisandbox.useredecloud.com.br'
    this.clientId = opts?.clientId || process.env.REDE_CLIENT_ID || ''
    this.clientSecret = opts?.clientSecret || process.env.REDE_CLIENT_SECRET || ''
    this.oauthPath = opts?.oauthPath || process.env.REDE_OAUTH_PATH || '/oauth/token'
  }

  isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret)
  }

  /**
   * Obtem access_token via OAuth 2.0 client_credentials.
   * Cacheia ate expires_in - 60s (margem de seguranca).
   */
  async getToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expires_at > Date.now()) {
      return this.tokenCache.access_token
    }
    if (!this.clientId || !this.clientSecret) {
      throw new Error('REDE_CLIENT_ID/SECRET nao configurado')
    }

    // Padrao OAuth 2.0 client_credentials: form-urlencoded com Basic auth
    // (Rede aceita ambos; usamos Basic + grant no body por compat).
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')
    const body = new URLSearchParams({ grant_type: 'client_credentials' })

    const r = await fetch(`${this.apiUrl}${this.oauthPath}`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(15000),
    })
    if (!r.ok) {
      const errBody = await r.text().catch(() => '')
      throw new Error(`Rede OAuth ${r.status}: ${errBody.substring(0, 200)}`)
    }
    const data = await r.json() as { access_token: string; token_type: string; expires_in: number }
    if (!data.access_token) throw new Error('Rede OAuth: response sem access_token')

    const expiresInMs = (data.expires_in || 3600) * 1000
    this.tokenCache = {
      access_token: data.access_token,
      token_type: data.token_type || 'Bearer',
      expires_at: Date.now() + expiresInMs - 60_000,
    }
    return data.access_token
  }

  /**
   * Solicita Opt-in (autorizacao do estabelecimento) pra consumir suas
   * vendas via API. A Rede exige esse passo formal mesmo quando o
   * integrador e o proprio estabelecimento.
   *
   * Endpoint:
   *   POST /partner/v1/organizations/requests/features/merchant-statement
   *
   * Body:
   *   { requestCompanyNumber: number,    // PV (matriz/filial/autonomo)
   *     companyNumbers: number[],         // filiais (vazio se Individual)
   *     requestType: 'I'|'P'|'T',          // I=Individual, P=Parcial, T=Total
   *     permissions: 'R' }                  // R=Leitura
   *
   * Response 201:
   *   { requestId, status:'PENDENTE', createdDate, requestCompanyNumber, companyNumbers }
   *
   * Response 409: ja existe solicitacao pendente — usar o requestId retornado.
   *
   * Apos sucesso, Karlao precisa aprovar em meu.userede.com.br >
   * minha Rede > Conciliacao > Compartilhar (delay ate 1h pra aparecer).
   */
  async requestOptIn(parentCompanyNumber: string | number, opts?: {
    companyNumbers?: number[]
    requestType?: 'I' | 'P' | 'T'
    permissions?: 'R'
  }): Promise<{ ok: boolean; status: number; body: any; path: string }> {
    const token = await this.getToken()
    const path = process.env.REDE_OPTIN_PATH || '/partner/v1/organizations/requests/features/merchant-statement'
    const payload = {
      requestCompanyNumber: typeof parentCompanyNumber === 'string' ? parseInt(parentCompanyNumber) : parentCompanyNumber,
      companyNumbers: opts?.companyNumbers || [],
      requestType: opts?.requestType || 'I',
      permissions: opts?.permissions || 'R',
    }

    const r = await fetch(`${this.apiUrl}${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    })
    const text = await r.text()
    let body: any = text
    try { body = JSON.parse(text) } catch {}
    return { ok: r.ok, status: r.status, body, path }
  }

  /**
   * Consulta status de uma solicitacao de opt-in pelo requestId.
   * GET /partner/v1/organizations/requests/{requestId}/features/merchant-statement
   *
   * Response 200:
   *   { requestId, status, createdDate, requestCompanyNumber, companyNumbers,
   *     partnerName, feature, requestType, permission, updateDate }
   *
   * Status: A=Aprovado, C=Cancelado, E=Expirado, P=Pendente, R=Reprovado
   */
  async getOptInStatus(requestId: string): Promise<{ ok: boolean; status: number; body: any; path: string }> {
    const token = await this.getToken()
    const path = `/partner/v1/organizations/requests/${requestId}/features/merchant-statement`

    const r = await fetch(`${this.apiUrl}${path}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    })
    const text = await r.text()
    let body: any = text
    try { body = JSON.parse(text) } catch {}
    return { ok: r.ok, status: r.status, body, path }
  }

  /**
   * Cancela uma solicitacao de opt-in pendente.
   * PUT /partner/v1/organizations/requests/{requestId}/features/merchant-statement/cancel
   */
  async cancelOptIn(requestId: string): Promise<{ ok: boolean; status: number; body: any; path: string }> {
    const token = await this.getToken()
    const path = `/partner/v1/organizations/requests/${requestId}/features/merchant-statement/cancel`

    const r = await fetch(`${this.apiUrl}${path}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    })
    const text = await r.text()
    let body: any = text
    try { body = JSON.parse(text) } catch {}
    return { ok: r.ok, status: r.status, body, path }
  }

  /**
   * Lista vendas paginando ate cobrir todo o intervalo.
   * Retorna ja em ParsedAcquirerTransaction[] pra cair no pipeline.
   *
   * @param parentCompanyNumber PV (em prod: 80361242)
   * @param startDate YYYY-MM-DD
   * @param endDate   YYYY-MM-DD
   */
  async listSales(parentCompanyNumber: string, startDate: string, endDate: string): Promise<ParsedAcquirerTransaction[]> {
    const token = await this.getToken()
    const all: ParsedAcquirerTransaction[] = []
    let cursor: string | undefined
    const pageSize = 100
    const maxPages = 50

    for (let page = 0; page < maxPages; page++) {
      const sp = new URLSearchParams({
        parentCompanyNumber,
        // API v1 prod exige `subsidiaries` (descoberto via 422 sem ele).
        // Quando integrador tem so a matriz, passa o proprio PV como subsidiary.
        subsidiaries: parentCompanyNumber,
        startDate,
        endDate,
        size: String(pageSize),
      })
      if (cursor) sp.set('cursor', cursor)

      const r = await fetch(`${this.apiUrl}/merchant-statement/v1/sales?${sp.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(30000),
      })
      if (!r.ok) {
        const errBody = await r.text().catch(() => '')
        throw new Error(`Rede /sales ${r.status}: ${errBody.substring(0, 200)}`)
      }
      const data = await r.json() as RedeSalesResponse
      const txns = data.content?.transactions || []
      for (const s of txns) {
        const parsed = mapRedeSale(s)
        if (parsed) all.push(parsed)
      }

      if (!data.cursor?.hasNextKey || !data.cursor.nextKey) break
      cursor = data.cursor.nextKey
    }

    return all
  }
}

/**
 * Mapeia uma RedeSale (response da API) pra ParsedAcquirerTransaction
 * (mesma shape que o parser CSV usa). Garante que pipeline de import
 * e match seja agnostico do source (CSV vs API).
 *
 * Nota: a API "Consultar Vendas" v1 NAO retorna a taxa de Recebimento
 * Automatico (RA) discriminada. Pra ela, ler /payments separadamente.
 * Aqui inicializamos anticipationFee = 0 e completamos depois.
 */
function mapRedeSale(s: RedeSale): ParsedAcquirerTransaction | null {
  if (!s.nsu || !s.saleDate || s.amount == null) return null

  const status = (s.status || '').toUpperCase()
  let normalizedStatus: 'APPROVED' | 'CANCELLED' | 'CHARGEBACK' | 'EXPIRED' = 'APPROVED'
  if (status.includes('CANCEL')) normalizedStatus = 'CANCELLED'
  else if (status.includes('CHARGEBACK')) normalizedStatus = 'CHARGEBACK'
  else if (status.includes('DENIED') || status.includes('EXPIR')) normalizedStatus = 'EXPIRED'

  const cardMasked = s.cardNumber || ''
  const cardLast4 = (cardMasked.match(/(\d{4})\s*$/) || [])[1] || undefined
  // B4 fix (audit): toCents (importado de rede-parser) pra floating-point safety
  const grossCents = toCents(s.amount || 0)
  const netCents = toCents(s.netAmount || 0)
  const mdrCents = toCents(s.mdrAmount || 0)

  const modalityType = (s.modality?.type || '').toUpperCase()
  const modality: 'credit' | 'debit' | undefined =
    modalityType === 'CREDIT' ? 'credit' :
    modalityType === 'DEBIT' ? 'debit' : undefined
  if (!modality) return null  // pula VAN (voucher) e desconhecidos

  return {
    acquirer: 'rede',
    externalId: String(s.nsu),
    authorizationCode: s.authorizationCode != null ? String(s.authorizationCode) : undefined,
    cardBrand: s.brandCode != null ? (BRAND_CODE_TO_NAME[s.brandCode] || `brand_${s.brandCode}`) : undefined,
    cardLast4,
    cardMasked: cardMasked || undefined,
    modality,
    installments: s.installmentQuantity || 1,
    grossAmount: grossCents,
    netAmount: netCents,
    mdrFeeAmount: mdrCents,
    mdrFeePercent: s.mdrFee || 0,
    anticipationFeeAmount: Math.max(0, grossCents - netCents - mdrCents), // estima por diferenca
    anticipationFeePercent: 0, // a API nao expoe; preencher via /payments depois
    totalFeeAmount: Math.max(0, grossCents - netCents),
    // M2 fix (audit): timezone BRT explícito pra match-engine ter dayDiff correto
    transactionDate: new Date(s.saleDate + 'T00:00:00-03:00'),
    transactionTime: s.saleHour,
    expectedCreditDate: undefined, // nao vem em /sales — pegar de /payments
    terminalCode: s.device,
    status: normalizedStatus,
    rawData: s as any,
  }
}
