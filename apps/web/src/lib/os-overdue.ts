import { prisma } from '@pontual/db'

/**
 * Sprint UX-31 (refactor da UX-26): helper compartilhado para "OS em atraso".
 *
 * Antes esse criterio aparecia inline em 2 arquivos:
 *  - /api/os/dashboard/route.ts (campo overdueCount)
 *  - /api/os/route.ts (filtro ?overdue=true)
 *
 * Cada um podia divergir silenciosamente — bug UX-26 (32 vs 29 vs 28). Agora ambos
 * chamam este helper e qualquer mudanca de criterio propaga automaticamente.
 *
 * CRITERIO CANONICO de "OS atrasada":
 *   1. Pertence ao company_id (multi-tenant)
 *   2. Nao soft-deleted (deleted_at IS NULL)
 *   3. Status NAO esta entre os terminais (is_final = true) — exclui CONCLUIDA,
 *      ENTREGUE, CANCELADA. Inclui apenas OS "vivas".
 *   4. Tem prazo definido (estimated_delivery NOT NULL) e o prazo passou
 *      (estimated_delivery < now)
 *
 * Retorna o objeto `where` Prisma pra usar em count/findMany/aggregate.
 */
export async function getOverdueOsWhereClause(companyId: string) {
  const finalStatuses = await prisma.moduleStatus.findMany({
    where: { company_id: companyId, module: 'os', is_final: true },
    select: { id: true },
  })
  const finalIds = finalStatuses.map(s => s.id)

  return {
    company_id: companyId,
    deleted_at: null,
    status_id: { notIn: finalIds },
    estimated_delivery: { lt: new Date() },
  }
}
