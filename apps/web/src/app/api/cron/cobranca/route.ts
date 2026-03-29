import { NextRequest } from 'next/server'
import { prisma } from '@pontual/db'
import { success, error, handleError } from '@/lib/api-response'
import { sendOverdueReminders } from '@/app/api/financeiro/cobranca/route'

/**
 * GET /api/cron/cobranca
 * Endpoint para cron externo (n8n, crontab, etc.) disparar cobranças automáticas.
 * Protegido por CRON_SECRET no header Authorization.
 */
export async function GET(request: NextRequest) {
  try {
    // Validar secret
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) {
      console.error('[Cron/Cobranca] CRON_SECRET não configurado')
      return error('Cron não configurado', 503)
    }

    const authHeader = request.headers.get('authorization')
    if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
      return error('Não autorizado', 401)
    }

    // Buscar todas as empresas com cobrança ativada
    const companiesWithCobranca = await prisma.setting.findMany({
      where: { key: 'cobranca.enabled', value: 'true' },
      select: { company_id: true },
    })

    if (companiesWithCobranca.length === 0) {
      // Se nenhuma empresa tem config, tentar todas as empresas ativas
      const allCompanies = await prisma.company.findMany({
        where: { is_active: true },
        select: { id: true },
      })

      let totalSent = 0
      const allErrors: string[] = []

      for (const company of allCompanies) {
        try {
          const { sent, errors } = await sendOverdueReminders(company.id, 'cron')
          totalSent += sent
          allErrors.push(...errors)
        } catch (err) {
          console.error(`[Cron/Cobranca] Erro empresa ${company.id}:`, err)
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

    for (const { company_id } of companiesWithCobranca) {
      try {
        const { sent, errors } = await sendOverdueReminders(company_id, 'cron')
        totalSent += sent
        allErrors.push(...errors)
      } catch (err) {
        console.error(`[Cron/Cobranca] Erro empresa ${company_id}:`, err)
        allErrors.push(`Erro ao processar empresa ${company_id}`)
      }
    }

    return success({
      companies_processed: companiesWithCobranca.length,
      emails_sent: totalSent,
      errors: allErrors,
    })
  } catch (err) {
    return handleError(err)
  }
}
