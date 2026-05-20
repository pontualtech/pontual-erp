import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'
import { STAGES } from '@/lib/marketing/stages'

export async function GET(_req: NextRequest) {
  try {
    const result = await requirePermission('dashboard', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const cId = user.companyId

    const counts = await Promise.all(
      STAGES.map(s =>
        prisma.marketingContact.count({
          where: { company_id: cId, tags: { has: s.tag } },
        })
      )
    )

    const total = counts.reduce((a, b) => a + b, 0)

    const funnel = STAGES.map((s, i) => ({
      key: s.key,
      label: s.label,
      color: s.color,
      count: counts[i],
      pctOfTotal: total > 0 ? counts[i] / total : 0,
    }))

    return success({ total, funnel })
  } catch (e) {
    return handleError(e)
  }
}
