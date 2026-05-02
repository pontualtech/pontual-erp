import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { prisma } from '@pontual/db'
import { success, error, handleError } from '@/lib/api-response'
import { sendQuoteReminders } from '@/app/api/os/lembrete-orcamento/route'

/**
 * GET /api/cron/lembrete-orcamento
 * Endpoint para cron externo (n8n, crontab, etc.) disparar lembretes de orçamento.
 * Protegido por CRON_SECRET no header Authorization.
 */
export async function GET(request: NextRequest) {
  // UX-10 #5: advisory lock + unlock garantido em finally (Prisma pool reuse)
  let lockAcquired = false
  try {
    const _lock: Array<{ ok: boolean }> = await (prisma as any).$queryRaw`
      SELECT pg_try_advisory_lock(hashtext('cron:lembrete-orcamento')::bigint) AS ok
    `
    if (!_lock?.[0]?.ok) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'concurrent_run' }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    lockAcquired = true
  } catch { /* non-fatal: tabela/conexao indisponivel — segue sem lock */ }

  try {
    // Validar secret
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) {
      console.error('[Cron/LembreteOrcamento] CRON_SECRET não configurado')
      return error('Cron não configurado', 503)
    }

    const authHeader = request.headers.get('authorization')
    const expected = `Bearer ${cronSecret}`
    if (!authHeader || authHeader.length !== expected.length || !timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))) {
      return error('Não autorizado', 401)
    }

    // Buscar empresas com lembrete de orçamento ativado
    const companiesWithReminder = await prisma.setting.findMany({
      where: { key: 'quote_reminder.enabled', value: 'true' },
      select: { company_id: true },
    })

    if (companiesWithReminder.length === 0) {
      // Se nenhuma empresa tem config, tentar todas as empresas ativas
      const allCompanies = await prisma.company.findMany({
        where: { is_active: true },
        select: { id: true },
      })

      let totalSent = 0
      const allErrors: string[] = []

      for (const company of allCompanies) {
        try {
          const { sent, errors } = await sendQuoteReminders(company.id, 'cron')
          totalSent += sent
          allErrors.push(...errors)
        } catch (err) {
          console.error(`[Cron/LembreteOrcamento] Erro empresa ${company.id}:`, err)
          allErrors.push(`Erro ao processar empresa ${company.id}`)
        }
      }

      return success({
        companies_processed: allCompanies.length,
        emails_sent: totalSent,
        errors: allErrors,
      })
    }

    let totalSent = 0
    const allErrors: string[] = []

    for (const { company_id } of companiesWithReminder) {
      try {
        const { sent, errors } = await sendQuoteReminders(company_id, 'cron')
        totalSent += sent
        allErrors.push(...errors)
      } catch (err) {
        console.error(`[Cron/LembreteOrcamento] Erro empresa ${company_id}:`, err)
        allErrors.push(`Erro ao processar empresa ${company_id}`)
      }
    }

    return success({
      companies_processed: companiesWithReminder.length,
      emails_sent: totalSent,
      errors: allErrors,
    })
  } catch (err) {
    return handleError(err)
  } finally {
    if (lockAcquired) {
      try {
        await (prisma as any).$queryRaw`SELECT pg_advisory_unlock(hashtext('cron:lembrete-orcamento')::bigint)`
      } catch { /* swallow */ }
    }
  }
}
