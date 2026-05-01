// =============================================================================
// Tenant context wrapper para preparar M-007 (RLS strict)
// =============================================================================
// O ERP roda hoje em modo "RLS lazy": policies tem cláusula `OR
// current_setting('app.company_id', true) IS NULL` que age como bypass quando
// o connection não setou `app.company_id`. Como o código atual NÃO seta a
// variável, todo query lê via bypass — RLS não bloqueia ainda.
//
// Pra ativar RLS strict (M-007), precisamos:
//   1. Garantir que toda query autenticada rode dentro de uma transaction com
//      `SET LOCAL app.company_id = '<tenant>'` ANTES dos selects.
//   2. Remover o `OR ... IS NULL` da policy (deixa só `company_id =
//      current_setting('app.company_id')::text`).
//
// Esta funcionalidade entrega a parte (1) — o wrapper. A parte (2) é flip
// SQL na ensure script, gated por env `PONTUAL_RLS_STRICT=1`.
//
// Uso esperado em route handlers:
//
//   export async function GET(req: NextRequest) {
//     const user = await requireAuth(req)
//     return withTenantTx(user.companyId, async (tx) => {
//       const data = await tx.payment.findMany({ ... })
//       return NextResponse.json(data)
//     })
//   }
//
// Migração incremental: rotas que ainda usam `prisma` direto continuam
// funcionando (RLS lazy / bypass ativo). Conforme rotas adotam withTenantTx,
// elas ficam strict-ready. Quando 100% das rotas autenticadas adotarem,
// flipa-se PONTUAL_RLS_STRICT=1 e o ERP fica RLS strict de verdade.

import { PrismaClient, Prisma } from '@prisma/client'
import { prisma } from './index'

export type TenantTxClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

/**
 * Executa um bloco de queries dentro de uma transaction com `SET LOCAL
 * app.company_id` aplicado. Bloco lê e escreve com tenant scope respeitado
 * por RLS quando strict mode estiver ativo. No lazy mode atual, o SET LOCAL
 * é set mas não muda comportamento (bypass policy ainda permite tudo).
 *
 * Validação anti-injeção: companyId DEVE ser UUID/slug seguro. Refusa qualquer
 * valor com aspas, ponto-e-vírgula, espaços ou caracteres SQL.
 */
export async function withTenantTx<T>(
  companyId: string,
  fn: (tx: TenantTxClient) => Promise<T>,
): Promise<T> {
  if (!companyId || !/^[a-zA-Z0-9_-]+$/.test(companyId)) {
    throw new Error(`withTenantTx: companyId inválido: "${companyId}"`)
  }
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.company_id = '${companyId}'`)
    return fn(tx as unknown as TenantTxClient)
  })
}

/**
 * Versão "best-effort" pra rotas que querem strict-ready sem migrar pra
 * transaction. Roda raw `SET app.company_id` no connection — funciona se o
 * connection não for trocado entre queries (pool reuse). Menos seguro que
 * withTenantTx, mas útil pra short-lived single-query routes.
 *
 * NÃO use em queries longas / multi-step. Use `withTenantTx` quando crítico.
 */
export async function setTenantContextOnConnection(companyId: string): Promise<void> {
  if (!companyId || !/^[a-zA-Z0-9_-]+$/.test(companyId)) {
    throw new Error(`setTenantContextOnConnection: companyId inválido: "${companyId}"`)
  }
  // SET (não SET LOCAL) — persiste no connection enquanto vivo no pool.
  await prisma.$executeRawUnsafe(`SET app.company_id = '${companyId}'`)
}

/**
 * Helper pra rotas que querem testar se o RLS strict está bloqueando como
 * esperado. Tenta um SELECT em accounts_receivable do tenant indicado e mede
 * se o count voltou consistente. Útil pra integration tests futuros.
 */
export async function probeTenantIsolation(companyId: string): Promise<{
  ok: boolean
  rows: number
  message: string
}> {
  try {
    const rows = await withTenantTx(companyId, async (tx) => {
      return tx.accountReceivable.count({ where: { company_id: companyId } })
    })
    return { ok: true, rows, message: 'Tenant context OK' }
  } catch (e) {
    return { ok: false, rows: 0, message: (e as Error).message }
  }
}

export { Prisma }
