import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('os', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const url = new URL(req.url)
    const equipment_type = url.searchParams.get('equipment_type') || ''
    const brand = url.searchParams.get('brand') || ''
    const model = url.searchParams.get('model') || ''

    if (!equipment_type && !brand && !model) {
      return success([])
    }

    const where: any = {
      company_id: user.companyId,
      is_active: true,
    }

    const orClauses: any[] = []

    if (equipment_type) {
      orClauses.push({ equipment_type: { contains: equipment_type, mode: 'insensitive' } })
    }
    if (brand) {
      orClauses.push({ brand: { contains: brand, mode: 'insensitive' } })
    }
    if (model) {
      orClauses.push({ model_pattern: { contains: model, mode: 'insensitive' } })
    }

    if (orClauses.length > 0) {
      where.OR = orClauses
    }

    const entries = await prisma.priceTable.findMany({
      where,
      take: 20,
      orderBy: { created_at: 'desc' },
    })

    // Score and sort by relevance
    type ScoredEntry = (typeof entries)[number] & { _score: number }
    const scored: ScoredEntry[] = entries.map(entry => {
      let score = 0
      const et = (entry.equipment_type || '').toLowerCase()
      const br = (entry.brand || '').toLowerCase()
      const mp = (entry.model_pattern || '').toLowerCase()
      const eqLower = equipment_type.toLowerCase()
      const brLower = brand.toLowerCase()
      const mdLower = model.toLowerCase()

      if (eqLower && et === eqLower) score += 10
      else if (eqLower && et.includes(eqLower)) score += 5

      if (brLower && br === brLower) score += 8
      else if (brLower && br.includes(brLower)) score += 4

      if (mdLower && mp) {
        if (mp === mdLower) score += 6
        else if (mdLower.includes(mp) || mp.includes(mdLower)) score += 3
      }

      return { ...entry, _score: score }
    })

    scored.sort((a: ScoredEntry, b: ScoredEntry) => b._score - a._score)

    // Remove score before returning
    const results = scored.map(({ _score, ...rest }: ScoredEntry) => rest)

    return success(results)
  } catch (err) {
    return handleError(err)
  }
}
