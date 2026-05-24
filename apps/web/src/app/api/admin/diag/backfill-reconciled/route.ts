import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireSuperAdmin } from '@/lib/auth'
import { requireInternalKey } from '@/lib/internal-auth'
import { success, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

/**
 * Wave Y (audit 2026-05-24): backfill reconciled=true em ARs/APs históricas.
 *
 * Bug raiz: até Wave Y, /[id]/baixa atualizava status PAGO/RECEBIDO mas
 * esquecia de setar reconciled=true. Resultado: TODA AR/AP baixada pelo botão
 * "Receber"/"Pagar" ficava eternamente com badge "Aguardando conciliação".
 *
 * Critério do backfill (conservador):
 *   - status IN ('PAGO', 'RECEBIDO')
 *   - account_id IS NOT NULL  (sem banco vinculado, badge âmbar continua correto)
 *   - reconciled IS NOT TRUE  (idempotente — não reprocessa)
 *
 * Idempotente. Auth dupla (super-admin OU x-internal-key).
 */

async function authGuard(req: NextRequest) {
  if (req.headers.get('x-internal-key')) {
    const guard = requireInternalKey(req)
    if (guard) return guard
    return null
  }
  const result = await requireSuperAdmin()
  if (result instanceof NextResponse) return result
  return null
}

export async function GET(req: NextRequest) {
  try {
    const guard = await authGuard(req)
    if (guard) return guard

    const companyId = req.nextUrl.searchParams.get('company_id') || undefined

    const arWhere: any = {
      status: { in: ['PAGO', 'RECEBIDO'] },
      account_id: { not: null },
      OR: [{ reconciled: false }, { reconciled: null }],
      deleted_at: null,
    }
    if (companyId) arWhere.company_id = companyId

    const apWhere: any = {
      status: { in: ['PAGO', 'RECEBIDO'] },
      account_id: { not: null },
      OR: [{ reconciled: false }, { reconciled: null }],
      deleted_at: null,
    }
    if (companyId) apWhere.company_id = companyId

    const [arCount, apCount] = await Promise.all([
      prisma.accountReceivable.count({ where: arWhere }),
      prisma.accountPayable.count({ where: apWhere }),
    ])

    return success({
      ar_candidates: arCount,
      ap_candidates: apCount,
      total: arCount + apCount,
    })
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const guard = await authGuard(req)
    if (guard) return guard

    const body = await req.json().catch(() => ({}))
    const dryRun: boolean = body.dry_run === true
    const companyId: string | undefined = body.company_id

    const arWhere: any = {
      status: { in: ['PAGO', 'RECEBIDO'] },
      account_id: { not: null },
      OR: [{ reconciled: false }, { reconciled: null }],
      deleted_at: null,
    }
    if (companyId) arWhere.company_id = companyId

    const apWhere: any = {
      status: { in: ['PAGO', 'RECEBIDO'] },
      account_id: { not: null },
      OR: [{ reconciled: false }, { reconciled: null }],
      deleted_at: null,
    }
    if (companyId) apWhere.company_id = companyId

    let arUpdated = 0
    let apUpdated = 0

    if (!dryRun) {
      const [arRes, apRes] = await Promise.all([
        prisma.accountReceivable.updateMany({
          where: arWhere,
          data: { reconciled: true, updated_at: new Date() },
        }),
        prisma.accountPayable.updateMany({
          where: apWhere,
          data: { reconciled: true, updated_at: new Date() },
        }),
      ])
      arUpdated = arRes.count
      apUpdated = apRes.count
    } else {
      const [arCount, apCount] = await Promise.all([
        prisma.accountReceivable.count({ where: arWhere }),
        prisma.accountPayable.count({ where: apWhere }),
      ])
      arUpdated = arCount
      apUpdated = apCount
    }

    logAudit({
      companyId: companyId || 'all',
      userId: 'system:backfill',
      module: 'financeiro',
      action: 'backfill_reconciled',
      newValue: { dry_run: dryRun, ar_updated: arUpdated, ap_updated: apUpdated },
    })

    return success({
      dry_run: dryRun,
      ar_updated: arUpdated,
      ap_updated: apUpdated,
      total: arUpdated + apUpdated,
    })
  } catch (err) {
    return handleError(err)
  }
}
