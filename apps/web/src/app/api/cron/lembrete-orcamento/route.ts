import { NextRequest } from 'next/server'
import { prisma } from '@pontual/db'
import { success, error, handleError } from '@/lib/api-response'
import { sendQuoteReminders } from '@/app/api/os/lembrete-orcamento/route'

/**
 * GET /api/cron/lembrete-orcamento
 * Endpoint para cron externo (n8n, crontab, etc.) disparar lembretes de orçamento.
 * Protegido por CRON_SECRET no header Authorization.
 */
export async function GET(request: NextRequest) {
  try {
    // Validar secret
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) {
      console.error('[Cron/LembreteOrcamento] CRON_SECRET não configurado')
      return error('Cron não configurado', 503)
    }

    const authHeader = request.headers.get('authorization')
    if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
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
  }
}
