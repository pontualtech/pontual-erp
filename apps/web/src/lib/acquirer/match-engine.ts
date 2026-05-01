import { prisma } from '@pontual/db'

/**
 * Engine de match automatico de transacoes de maquininha → OSes do ERP.
 *
 * Score (0-100):
 *   40 = valor exato (eliminatorio: sem isso, score zero)
 *   25 = data da venda dentro de janela
 *      25 pts: dia exato
 *      18 pts: ±1 dia
 *      10 pts: ±3 dias
 *       0 pts: alem disso
 *   25 = atribuicao da maquininha (terminal_code) coerente:
 *       DRIVER: OS tem logistics_stop daquele motorista na data
 *       STORE:  OS tem os_location='LOJA' na data
 *      sem assignment: 12 pts (parcial — nao penaliza completamente)
 *   10 = forma de pagamento esperada bate (OS payment_method == cartao)
 *
 * Threshold de auto-vinculo: 95
 * Sugestao no modal (pre-seleciona): 80-94
 * Manual: < 80 ou multiplos candidatos com score similar
 */

export interface MatchCandidate {
  os_id: string
  os_number: number
  total_cost: number
  customer_name: string
  customer_id: string
  score: number
  reasons: string[]
  created_at: Date
}

export interface MatchResult {
  transaction_id: string
  best: MatchCandidate | null
  candidates: MatchCandidate[]    // top 5 ordenado por score
  auto_link: boolean              // best.score >= AUTO_THRESHOLD e e unico no topo
  reason_skip?: string
}

const AUTO_THRESHOLD = 95
const SUGGESTION_THRESHOLD = 80

interface TxnInput {
  id: string
  company_id: string
  gross_amount: number
  transaction_date: Date
  terminal_code: string | null
  modality: string | null
  matched_payment_id: string | null
}

/**
 * Calcula score de 1 OS pra 1 transacao.
 */
async function scoreOS(
  txn: TxnInput,
  os: { id: string; os_number: number; total_cost: number | null; created_at: Date | null; customer_id: string; payment_method: string | null; os_location: string | null; technician_id: string | null },
  customerName: string,
  expectedDriverId: string | null,
  expectedAsStore: boolean,
): Promise<MatchCandidate> {
  let score = 0
  const reasons: string[] = []

  // 1. Valor exato (40)
  if ((os.total_cost || 0) !== txn.gross_amount) {
    return {
      os_id: os.id,
      os_number: os.os_number,
      total_cost: os.total_cost || 0,
      customer_name: customerName,
      customer_id: os.customer_id,
      score: 0,
      reasons: ['valor diferente'],
      created_at: os.created_at || new Date(),
    }
  }
  score += 40
  reasons.push('valor exato (+40)')

  // 2. Data — janela tolerante a parcelamento (ate 30 dias)
  // M2 fix (audit): comparar dia em TZ BRT consistente. Antes, comparação
  // direta de getTime() podia errar por 1 em transações próximas da
  // meia-noite (servidor UTC vs CSV BRT) — score caía de 25 pra 22 e
  // auto-link não atingia threshold 95.
  const osDate = os.created_at ? new Date(os.created_at) : new Date()
  const txnDate = new Date(txn.transaction_date)
  const osDayBR = osDate.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const txnDayBR = txnDate.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const dayDiff = Math.abs(Math.round(
    (new Date(txnDayBR + 'T00:00:00-03:00').getTime() -
     new Date(osDayBR + 'T00:00:00-03:00').getTime()) / (1000 * 60 * 60 * 24)
  ))
  if (dayDiff === 0) { score += 25; reasons.push('mesmo dia (+25)') }
  else if (dayDiff <= 1) { score += 22; reasons.push(`±1 dia (+22)`) }
  else if (dayDiff <= 3) { score += 18; reasons.push(`±${dayDiff} dias (+18)`) }
  else if (dayDiff <= 7) { score += 14; reasons.push(`±${dayDiff} dias (+14)`) }
  else if (dayDiff <= 15) { score += 10; reasons.push(`±${dayDiff} dias (+10)`) }
  else if (dayDiff <= 30) { score += 6;  reasons.push(`±${dayDiff} dias (+6)`) }
  else { reasons.push(`${dayDiff} dias afastado (+0)`) }

  // 3. Atribuicao da maquininha
  if (expectedAsStore) {
    if (os.os_location === 'LOJA') {
      score += 25
      reasons.push('OS de balcao + maquininha de loja (+25)')
    } else {
      reasons.push('OS externa mas maquininha de loja (+0)')
    }
  } else if (expectedDriverId) {
    // OS atribuida ao motorista direto?
    if (os.technician_id === expectedDriverId) {
      score += 25
      reasons.push('mesmo motorista (+25)')
    } else {
      // Tem stop desse motorista nessa OS?
      const hasStop = await prisma.logisticsStop.count({
        where: {
          os_id: os.id,
          route: { driver_id: expectedDriverId },
        },
      })
      if (hasStop > 0) {
        score += 25
        reasons.push('motorista correto via logistics_stop (+25)')
      } else {
        reasons.push('motorista divergente (+0)')
      }
    }
  } else {
    // Sem assignment configurado — score parcial
    score += 12
    reasons.push('terminal sem atribuicao (+12)')
  }

  // 4. Modalidade compativel com payment_method da OS
  if (os.payment_method) {
    const pm = os.payment_method.toLowerCase()
    if (txn.modality === 'credit' && /cart|credit|cred/.test(pm)) {
      score += 10
      reasons.push('forma cartao credito coerente (+10)')
    } else if (txn.modality === 'debit' && /debit|deb/.test(pm)) {
      score += 10
      reasons.push('forma cartao debito coerente (+10)')
    } else {
      reasons.push(`forma divergente: txn=${txn.modality} os=${pm} (+0)`)
    }
  } else {
    score += 5 // benefit-of-doubt
    reasons.push('OS sem forma definida (+5)')
  }

  return {
    os_id: os.id,
    os_number: os.os_number,
    total_cost: os.total_cost || 0,
    customer_name: customerName,
    customer_id: os.customer_id,
    score,
    reasons,
    created_at: os.created_at || new Date(),
  }
}

/**
 * Resolve assignment da maquininha vigente na data da transacao.
 */
async function resolveAssignment(companyId: string, terminalCode: string | null, txnDate: Date) {
  if (!terminalCode) return { driverId: null, asStore: false }
  const a = await prisma.acquirerTerminalAssignment.findFirst({
    where: {
      company_id: companyId,
      terminal_code: terminalCode,
      valid_from: { lte: txnDate },
      OR: [{ valid_to: null }, { valid_to: { gte: txnDate } }],
    },
    orderBy: { valid_from: 'desc' },
  })
  if (!a) return { driverId: null, asStore: false }
  if (a.assignment_type === 'STORE') return { driverId: null, asStore: true }
  return { driverId: a.user_id, asStore: false }
}

/**
 * Procura candidatas e retorna match result.
 * Nao executa a vinculacao — apenas calcula.
 */
export async function findMatch(txnId: string): Promise<MatchResult> {
  const txn = await prisma.acquirerTransaction.findUnique({ where: { id: txnId } })
  if (!txn) return { transaction_id: txnId, best: null, candidates: [], auto_link: false, reason_skip: 'txn nao encontrada' }
  if (txn.matched_payment_id) {
    return { transaction_id: txnId, best: null, candidates: [], auto_link: false, reason_skip: 'ja vinculada' }
  }
  if (txn.status !== 'APPROVED') {
    return { transaction_id: txnId, best: null, candidates: [], auto_link: false, reason_skip: `status ${txn.status}` }
  }

  const { driverId, asStore } = await resolveAssignment(txn.company_id, txn.terminal_code, txn.transaction_date)

  // Busca OSes candidatas (mesmo valor, -30 / +1 dias).
  // Janela ampla pra cobrir parcelamento — cliente pode ter feito a OS
  // semanas antes da 1a parcela cair na maquininha (ex: 4x sem juros
  // entre data da venda e 1a captura pode ter ~30 dias de gap).
  const startDate = new Date(txn.transaction_date)
  startDate.setDate(startDate.getDate() - 30)
  const endDate = new Date(txn.transaction_date)
  endDate.setDate(endDate.getDate() + 1)

  const osCandidates = await prisma.serviceOrder.findMany({
    where: {
      company_id: txn.company_id,
      total_cost: txn.gross_amount,
      created_at: { gte: startDate, lte: endDate },
      deleted_at: null,
    },
    select: {
      id: true,
      os_number: true,
      total_cost: true,
      created_at: true,
      customer_id: true,
      payment_method: true,
      os_location: true,
      technician_id: true,
      customers: { select: { legal_name: true } },
    },
    take: 50,
  })

  if (osCandidates.length === 0) {
    return {
      transaction_id: txnId,
      best: null,
      candidates: [],
      auto_link: false,
      reason_skip: 'nenhuma OS com mesmo valor em ±7 dias',
    }
  }

  // Score cada candidata
  const scored = await Promise.all(
    osCandidates.map(os => scoreOS(txn, os, os.customers?.legal_name || 'Cliente', driverId, asStore)),
  )

  // Ordena desc por score
  scored.sort((a, b) => b.score - a.score)

  const best = scored[0]
  const second = scored[1]

  // Auto-link: top score >= 95 e GAP > 10 pontos pro 2o (evita ambiguidade)
  const gap = second ? best.score - second.score : 100
  const autoLink = best.score >= AUTO_THRESHOLD && gap >= 10

  return {
    transaction_id: txnId,
    best: best.score >= SUGGESTION_THRESHOLD ? best : null,
    candidates: scored.slice(0, 5),
    auto_link: autoLink,
  }
}

/**
 * Faz auto-match em todas pendentes da empresa (ou subconjunto).
 * Retorna stats. Nao vincula — apenas calcula. Vinculacao real e
 * feita em endpoint separado pra reusar logica de criacao de Payment.
 */
export async function findMatchesBatch(companyId: string, txnIds?: string[]) {
  const where: any = { company_id: companyId, matched_payment_id: null, status: 'APPROVED' }
  if (txnIds && txnIds.length > 0) where.id = { in: txnIds }

  const list = await prisma.acquirerTransaction.findMany({
    where,
    select: { id: true },
    take: 500,
  })

  const results: MatchResult[] = []
  for (const t of list) {
    const r = await findMatch(t.id)
    results.push(r)
  }
  return results
}

export const MATCH_AUTO_THRESHOLD = AUTO_THRESHOLD
export const MATCH_SUGGESTION_THRESHOLD = SUGGESTION_THRESHOLD
