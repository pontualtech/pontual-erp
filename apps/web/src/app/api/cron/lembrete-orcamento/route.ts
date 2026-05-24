import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { prisma } from '@pontual/db'
import { success, error, handleError } from '@/lib/api-response'
import { sendQuoteReminders, sendQuoteWhatsAppReminders } from '@/app/api/os/lembrete-orcamento/route'

// Next 14: route depende de cookies/headers/searchParams — força runtime
export const dynamic = 'force-dynamic'

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

    // Wave AE-1 (2026-05-24): restringe a PontualTech (igual atraso-reparo).
    // Imprimitech tem fluxo próprio. Pra estender, adicionar slug aqui.
    // Buscar empresas com lembrete (email) ativado.
    const companiesWithReminder = await prisma.setting.findMany({
      where: { key: 'quote_reminder.enabled', value: 'true' },
      select: { company_id: true },
    })

    const pontualtechCompanies = await prisma.company.findMany({
      where: { is_active: true, slug: 'pontualtech' },
      select: { id: true },
    })
    const pontualtechIds = new Set<string>(pontualtechCompanies.map((c: { id: string }) => c.id))

    // Empresas-alvo: se tem toggle email ativo OU é pontualtech (whatsapp pode estar
    // habilitado mesmo sem email). Sempre filtrando p/ slug pontualtech.
    const enabledIds = new Set<string>(companiesWithReminder.map((s: { company_id: string }) => s.company_id))
    const targetCompanyIds = Array.from(new Set<string>([
      ...Array.from(enabledIds).filter((id: string) => pontualtechIds.has(id)),
      ...Array.from(pontualtechIds),
    ]))

    let totalEmailSent = 0
    let totalWhatsAppSent = 0
    const allErrors: string[] = []

    for (const companyId of targetCompanyIds) {
      // Email — só roda se quote_reminder.enabled=true
      if (enabledIds.has(companyId)) {
        try {
          const { sent, errors } = await sendQuoteReminders(companyId, 'cron')
          totalEmailSent += sent
          allErrors.push(...errors)
        } catch (err) {
          console.error(`[Cron/LembreteOrcamento] Erro email empresa ${companyId}:`, err)
          allErrors.push(`Erro email empresa ${companyId}`)
        }
      }
      // WhatsApp — sempre tenta; sendQuoteWhatsAppReminders verifica setting
      // quote_reminder.whatsapp_enabled internamente e retorna skipped se off.
      try {
        const wa = await sendQuoteWhatsAppReminders(companyId, 'cron')
        totalWhatsAppSent += wa.sent
        if (wa.errors) allErrors.push(...wa.errors)
      } catch (err) {
        console.error(`[Cron/LembreteOrcamento] Erro whatsapp empresa ${companyId}:`, err)
        allErrors.push(`Erro whatsapp empresa ${companyId}`)
      }
    }

    return success({
      companies_processed: targetCompanyIds.length,
      emails_sent: totalEmailSent,
      whatsapp_sent: totalWhatsAppSent,
      errors: allErrors,
    })
  } catch (err) {
    return handleError(err)
  } finally {
    if (lockAcquired) {
      try {
        // Sprint UX-27 audit: $executeRaw em vez de $queryRaw — resultado nao
        // e usado, evita risco de Prisma 5.22+ rejeitar void deserialize.
        await (prisma as any).$executeRaw`SELECT pg_advisory_unlock(hashtext('cron:lembrete-orcamento')::bigint)`
      } catch { /* swallow — connection drop libera auto */ }
    }
  }
}
