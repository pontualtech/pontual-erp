// Resolvedor central de CONTA DESTINO por método de pagamento.
//
// Eco audit 13/06: 93 ARs RECEBIDO (40% da receita, R$75k) ficaram com
// account_id=null porque os fluxos de cobrança automáticos não resolviam o
// banco destino. Sem account_id, o webhook de pagamento NÃO credita saldo
// e a conciliação com extrato é impossível. Este módulo é a fonte única da
// verdade método→conta, usada por todos os fluxos ao marcar AR como recebida.
//
// Mapa (decisão Karlão 13/06):
//   PIX           → finance.account.pix (Itaú); se origem=portal/asaas → finance.account.pix_portal (ASSAS)
//   BOLETO        → finance.account.boleto (ASSAS)
//   CREDIT/DEBIT  → acquirer.rede.account_id (Itaú — maquininha)
//   CASH          → finance.account.cash (Itaú)
//   OTHER/default → finance.account.default (Itaú)

export type CanonicalMethod = 'PIX' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'BOLETO' | 'CASH' | 'OTHER'

/**
 * Normaliza os rótulos divergentes de payment_method gravados no banco
 * ("CREDIT_CARD" vs "Cartão Crédito" vs "CARTAO_CREDITO", "BOLETO" vs "Boleto",
 * "Dinheiro" vs "CASH", etc.) para um enum canônico.
 */
export function normalizePaymentMethod(raw?: string | null): CanonicalMethod {
  const s = (raw || '').trim().toLowerCase()
  if (!s) return 'OTHER'
  if (/pix/.test(s)) return 'PIX'
  if (/(debito|débito|debit)/.test(s)) return 'DEBIT_CARD'
  if (/(credito|crédito|credit|cart[aã]o|card)/.test(s)) return 'CREDIT_CARD'
  if (/(boleto|cnab|bank_slip)/.test(s)) return 'BOLETO'
  if (/(dinheiro|cash|espécie|especie)/.test(s)) return 'CASH'
  return 'OTHER'
}

// origem indica pagamento gerado/recebido via Asaas (portal do cliente).
function isAsaasSource(source?: string | null): boolean {
  const s = (source || '').toLowerCase()
  return /portal|asaas|assas/.test(s)
}

type PrismaLike = {
  setting: { findFirst: (args: { where: { company_id?: string; key: string }; select?: any }) => Promise<{ value: string } | null> }
}

/**
 * Resolve a conta bancária destino (account_id) para um pagamento.
 * Retorna null (sem inventar conta) se não houver mapeamento nem default —
 * o chamador deve logar/seguir, e o backfill/manual cobre o resíduo.
 */
export async function resolveDestinationAccount(
  prisma: PrismaLike,
  companyId: string,
  paymentMethod?: string | null,
  source?: string | null,
): Promise<string | null> {
  const method = normalizePaymentMethod(paymentMethod)

  let key: string
  switch (method) {
    case 'PIX':
      key = isAsaasSource(source) ? 'finance.account.pix_portal' : 'finance.account.pix'
      break
    case 'BOLETO':
      key = 'finance.account.boleto'
      break
    case 'CREDIT_CARD':
    case 'DEBIT_CARD':
      key = 'acquirer.rede.account_id'
      break
    case 'CASH':
      key = 'finance.account.cash'
      break
    default:
      key = 'finance.account.default'
  }

  const hit = await prisma.setting.findFirst({ where: { company_id: companyId, key }, select: { value: true } })
  if (hit?.value) return hit.value

  // Fallback pro default configurável
  const def = await prisma.setting.findFirst({ where: { company_id: companyId, key: 'finance.account.default' }, select: { value: true } })
  if (def?.value) return def.value

  console.warn(`[account-resolver] sem conta destino p/ metodo=${method} source=${source || '-'} company=${companyId} — AR ficara sem account_id`)
  return null
}
