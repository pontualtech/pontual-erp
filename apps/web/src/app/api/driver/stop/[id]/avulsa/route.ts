import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireDriver } from '@/lib/driver-auth'

/**
 * POST /api/driver/stop/[id]/avulsa
 * Body: { action: 'arrive' | 'complete' | 'fail', notes?: string, reason?: string }
 *
 * Fluxo simplificado de paradas AVULSAS (sem OS). So marca status da
 * parada e completa a rota quando for a ultima. Nao mexe em OS, cliente,
 * checklist, pagamento, assinatura — a parada AVULSA nao tem nada disso.
 *
 * Guarda: parada precisa ter type = AVULSA. Se chegar aqui com type
 * COLETA/ENTREGA, retorna 400 (use os endpoints especificos).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireDriver()
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')
  if (!['arrive', 'complete', 'fail'].includes(action)) {
    return NextResponse.json({ error: 'action invalida' }, { status: 400 })
  }

  const stop = await prisma.logisticsStop.findFirst({
    where: { id: params.id, company_id: auth.companyId },
    include: { route: { select: { id: true, driver_id: true, total_stops: true, completed_stops: true } } },
  })
  if (!stop) return NextResponse.json({ error: 'Parada nao encontrada' }, { status: 404 })
  if (stop.route.driver_id && stop.route.driver_id !== auth.id && !auth.isSuperAdmin) {
    return NextResponse.json({ error: 'Parada nao pertence a sua rota' }, { status: 403 })
  }
  if (stop.type !== 'AVULSA') {
    return NextResponse.json({ error: 'Parada nao e AVULSA — use coleta/entrega' }, { status: 400 })
  }
  if (stop.status === 'COMPLETED' || stop.status === 'FAILED') {
    return NextResponse.json({ error: 'Parada ja finalizada' }, { status: 400 })
  }

  const now = new Date()
  const notes = typeof body.notes === 'string' ? body.notes.trim() : ''
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''

  if (action === 'arrive') {
    await prisma.logisticsStop.update({
      where: { id: stop.id },
      data: {
        status: 'ARRIVED',
        arrived_at: stop.arrived_at || now,
        notes: notes || stop.notes,
      },
    })
    return NextResponse.json({ data: { id: stop.id, status: 'ARRIVED' } })
  }

  if (action === 'complete') {
    await prisma.$transaction([
      prisma.logisticsStop.update({
        where: { id: stop.id },
        data: {
          status: 'COMPLETED',
          completed_at: now,
          arrived_at: stop.arrived_at || now,
          notes: notes || stop.notes,
        },
      }),
      prisma.logisticsRoute.update({
        where: { id: stop.route.id },
        data: { completed_stops: { increment: 1 } },
      }),
    ])
    return NextResponse.json({ data: { id: stop.id, status: 'COMPLETED' } })
  }

  // action === 'fail'
  if (!reason) return NextResponse.json({ error: 'reason obrigatoria na falha' }, { status: 400 })
  await prisma.logisticsStop.update({
    where: { id: stop.id },
    data: {
      status: 'FAILED',
      completed_at: now,
      failure_reason: reason,
    },
  })
  return NextResponse.json({ data: { id: stop.id, status: 'FAILED' } })
}
