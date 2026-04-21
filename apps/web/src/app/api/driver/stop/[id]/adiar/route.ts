import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireDriver } from '@/lib/driver-auth'

/**
 * POST /api/driver/stop/[id]/adiar
 * body: { reason: string, reschedule_at?: string (ISO) }
 *
 * Driver-scoped version: motorista marca parada como adiada e empurra
 * pro fim da rota. Mantem PENDING — cliente ainda pode aparecer.
 * Popula visit_reschedule_at + visit_reschedule_note pra aparecer em
 * ambar na lista.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireDriver()
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => ({}))
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!reason) return NextResponse.json({ error: 'Informe o motivo' }, { status: 400 })
  const rescheduleAt = body.reschedule_at ? new Date(body.reschedule_at) : new Date()

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const stop = await tx.logisticsStop.findFirst({
        where: { id: params.id, company_id: auth.companyId },
        include: { route: { select: { driver_id: true } } },
      })
      if (!stop) throw new Error('NOT_FOUND')
      if (stop.route?.driver_id !== auth.id) throw new Error('FORBIDDEN')
      if (stop.status === 'COMPLETED' || stop.status === 'FAILED') throw new Error('FINALIZED')

      const maxRow = await tx.logisticsStop.findFirst({
        where: { route_id: stop.route_id, company_id: auth.companyId },
        orderBy: { sequence: 'desc' },
        select: { sequence: true },
      })
      const newSeq = Math.max((maxRow?.sequence ?? 0) + 1, stop.sequence)

      return tx.logisticsStop.update({
        where: { id: stop.id },
        data: {
          sequence: newSeq,
          visit_reschedule_at: rescheduleAt,
          visit_reschedule_note: reason.slice(0, 500),
        },
      })
    })

    return NextResponse.json({
      data: {
        id: updated.id,
        sequence: updated.sequence,
        visit_reschedule_at: updated.visit_reschedule_at,
        visit_reschedule_note: updated.visit_reschedule_note,
      },
    })
  } catch (err: any) {
    if (err?.message === 'NOT_FOUND') return NextResponse.json({ error: 'Parada nao encontrada' }, { status: 404 })
    if (err?.message === 'FORBIDDEN') return NextResponse.json({ error: 'Parada nao pertence a sua rota' }, { status: 403 })
    if (err?.message === 'FINALIZED') return NextResponse.json({ error: 'Parada ja finalizada' }, { status: 400 })
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
