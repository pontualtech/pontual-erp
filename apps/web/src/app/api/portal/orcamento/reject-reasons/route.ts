import { NextRequest } from 'next/server'
import { prisma } from '@pontual/db'
import { success, handleError } from '@/lib/api-response'

const DEFAULT_REASONS = [
  'O valor nao compensa o conserto',
  'Estou sem recursos no momento',
  'Vou comprar um equipamento novo',
  'Encontrei um servico mais barato',
  'Desisti do reparo',
  'O equipamento nao e mais necessario',
  'Vou tentar resolver por conta propria',
  'Outros motivos',
]

/**
 * GET /api/portal/orcamento/reject-reasons?slug=pontualtech
 * Returns customizable reject reasons for the company.
 * Stored in Settings key: quote.reject_reasons (JSON array)
 */
export async function GET(req: NextRequest) {
  try {
    const slug = req.nextUrl.searchParams.get('slug')
    if (!slug) return success(DEFAULT_REASONS)

    const company = await prisma.company.findFirst({
      where: { slug, is_active: true },
      select: { id: true },
    })
    if (!company) return success(DEFAULT_REASONS)

    const setting = await prisma.setting.findUnique({
      where: { company_id_key: { company_id: company.id, key: 'quote.reject_reasons' } },
    })

    if (setting?.value) {
      try {
        const reasons = JSON.parse(setting.value)
        if (Array.isArray(reasons) && reasons.length > 0) return success(reasons)
      } catch {}
    }

    return success(DEFAULT_REASONS)
  } catch (err) {
    return handleError(err)
  }
}
