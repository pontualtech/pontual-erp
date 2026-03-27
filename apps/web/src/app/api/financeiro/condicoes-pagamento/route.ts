import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'
import crypto from 'crypto'

const createPaymentConditionSchema = z.object({
  name: z.string().min(1, 'Nome obrigatório'),
  installments: z.number().int().min(1).default(1),
  interval_days: z.number().int().min(0).default(30),
  down_payment_pct: z.number().min(0).max(100).default(0),
})

export async function GET(_req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const settings = await prisma.setting.findMany({
      where: {
        company_id: user.companyId,
        key: { startsWith: 'cond_pgto.' },
      },
      orderBy: { key: 'asc' },
    })

    const conditions = settings.map((s) => {
      const parsed = JSON.parse(s.value)
      return {
        id: s.id,
        key: s.key,
        ...parsed,
        created_at: s.created_at,
        updated_at: s.updated_at,
      }
    })

    return success(conditions)
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'create')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()
    const data = createPaymentConditionSchema.parse(body)

    const uid = crypto.randomUUID()
    const key = `cond_pgto.${uid}`

    const value = JSON.stringify({
      name: data.name,
      installments: data.installments,
      interval_days: data.interval_days,
      down_payment_pct: data.down_payment_pct,
    })

    const setting = await prisma.setting.create({
      data: {
        company_id: user.companyId,
        key,
        value,
        type: 'json',
      },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'payment_condition.create',
      entityId: setting.id,
      newValue: { name: data.name, installments: data.installments },
    })

    return success(
      {
        id: setting.id,
        key: setting.key,
        ...data,
        created_at: setting.created_at,
        updated_at: setting.updated_at,
      },
      201
    )
  } catch (err) {
    return handleError(err)
  }
}
