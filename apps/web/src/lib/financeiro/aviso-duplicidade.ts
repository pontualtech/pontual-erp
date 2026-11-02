import { prisma } from '@pontual/db'
import { logError } from '@/lib/observability'

/**
 * Fix 6 (F6-F, m5/m6): aviso 'possível duplicidade' em error_logs (warning). Chamado DEPOIS do commit da transação que
 * decidiu (nunca num rollback) e uma vez por evento: `chave` (ex. '(pay_x)', '(NSU 123)') vai no texto e um aviso com a
 * mesma chave nas últimas 24 h não é gravado de novo (reenvio do webhook, match repetido).
 */
export async function avisarDuplicidade(
  companyId: string,
  chave: string,
  mensagem: string,
  contexto: { url: string; params?: Record<string, unknown> },
): Promise<void> {
  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const ja = await prisma.errorLog
    .findFirst({ where: { company_id: companyId, level: 'warning', message: { contains: chave }, ts: { gte: desde } }, select: { id: true } })
    .catch(() => null)
  if (ja) return
  await logError(new Error(`${mensagem} ${chave}`), { url: contexto.url, method: 'POST', company_id: companyId, params: contexto.params }, 'warning')
}
