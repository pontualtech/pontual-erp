import { prisma } from '@pontual/db'
import type { Prisma } from '@prisma/client'

type Tx = Prisma.TransactionClient | typeof prisma

/**
 * Propaga o valor de um orcamento APROVADO pra ServiceOrder.total_cost
 * e approved_cost. Eh chamada em todos os caminhos que aprovam um Quote
 * (portal token, portal direto, painel admin).
 *
 * Por que isso importa: a tabela `quotes` guarda `total_amount`, mas o
 * match-engine de maquininha procura OSes por `service_order.total_cost`.
 * Sem essa propagacao, OSes que tiveram orcamento aprovado via link
 * por email ficam com total_cost=0 e nunca casam com transacoes Rede.
 *
 * Politica: NAO sobrescreve total_cost > 0 ja existente (evita pisar
 * em valores que vieram via service_order_items). So preenche se zero.
 *
 * Idempotente: pode ser chamada multiplas vezes pro mesmo quote sem
 * efeito colateral (a 2a chamada vira no-op pois total_cost ja eh > 0).
 */
export async function propagateQuoteApprovalToOS(
  tx: Tx,
  quoteId: string,
): Promise<{ updated: boolean; reason: string }> {
  const quote = await tx.quote.findUnique({
    where: { id: quoteId },
    select: {
      service_order_id: true,
      total_amount: true,
      status: true,
    },
  })
  if (!quote) return { updated: false, reason: 'quote_not_found' }
  if (quote.status !== 'APPROVED') return { updated: false, reason: 'quote_not_approved' }
  if (!quote.total_amount || quote.total_amount <= 0) {
    return { updated: false, reason: 'quote_zero_amount' }
  }

  const os = await tx.serviceOrder.findUnique({
    where: { id: quote.service_order_id },
    select: { id: true, total_cost: true, approved_cost: true },
  })
  if (!os) return { updated: false, reason: 'os_not_found' }

  const updates: Prisma.ServiceOrderUpdateInput = {}
  if (!os.total_cost || os.total_cost === 0) {
    updates.total_cost = quote.total_amount
  }
  if (!os.approved_cost || os.approved_cost === 0) {
    updates.approved_cost = quote.total_amount
  }
  if (Object.keys(updates).length === 0) {
    return { updated: false, reason: 'os_already_has_values' }
  }

  await tx.serviceOrder.update({ where: { id: os.id }, data: updates })
  return { updated: true, reason: 'propagated' }
}
