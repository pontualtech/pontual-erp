import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireDriver } from '@/lib/driver-auth'

/**
 * PATCH /api/driver/stop/[id]/move
 * body: { direction: 'up' | 'down' | 'bottom' }
 *
 * Versao driver-scoped do reorder. Identica em efeito a
 * /api/logistics/routes/[id]/stops/[stopId]/move mas autenticada via
 * requireDriver + valida que a parada pertence a rota do motorista.
 * Paradas COMPLETED/FAILED nao podem ser movidas.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireDriver()
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => ({}))
  const direction: 'up' | 'down' | 'bottom' = body.direction
  if (!['up', 'down', 'bottom'].includes(direction)) {
    return NextResponse.json({ error: 'direction deve ser up, down ou bottom' }, { status: 400 })
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const stop = await tx.logisticsStop.findFirst({
        where: { id: params.id, company_id: auth.companyId },
        include: { route: { select: { driver_id: true } } },
      })
      if (!stop) throw new Error('NOT_FOUND')
      if (stop.route?.driver_id !== auth.id) throw new Error('FORBIDDEN')
      if (stop.status === 'COMPLETED' || stop.status === 'FAILED') throw new Error('FINALIZED')

      if (direction === 'bottom') {
        const maxRow = await tx.logisticsStop.findFirst({
          where: { route_id: stop.route_id, company_id: auth.companyId },
          orderBy: { sequence: 'desc' },
          select: { sequence: true },
        })
        const newSeq = (maxRow?.sequence ?? 0) + 1
        if (newSeq === stop.sequence) return stop
        return tx.logisticsStop.update({
          where: { id: stop.id },
          data: { sequence: newSeq },
        })
      }

      const neighbor = direction === 'up'
        ? await tx.logisticsStop.findFirst({
            where: {
              route_id: stop.route_id, company_id: auth.companyId,
              sequence: { lt: stop.sequence },
              status: { notIn: ['COMPLETED', 'FAILED'] },
            },
            orderBy: { sequence: 'desc' },
          })
        : await tx.logisticsStop.findFirst({
            where: {
              route_id: stop.route_id, company_id: auth.companyId,
              sequence: { gt: stop.sequence },
              status: { notIn: ['COMPLETED', 'FAILED'] },
            },
            orderBy: { sequence: 'asc' },
          })
      if (!neighbor) return stop

      const tempSeq = -Math.abs(stop.sequence) - 10_000
      await tx.logisticsStop.update({ where: { id: stop.id }, data: { sequence: tempSeq } })
      await tx.logisticsStop.update({ where: { id: neighbor.id }, data: { sequence: stop.sequence } })
      return tx.logisticsStop.update({ where: { id: stop.id }, data: { sequence: neighbor.sequence } })
    })

    return NextResponse.json({ data: { id: updated.id, sequence: updated.sequence } })
  } catch (err: any) {
    if (err?.message === 'NOT_FOUND') return NextResponse.json({ error: 'Parada nao encontrada' }, { status: 404 })
    if (err?.message === 'FORBIDDEN') return NextResponse.json({ error: 'Parada nao pertence a sua rota' }, { status: 403 })
    if (err?.message === 'FINALIZED') return NextResponse.json({ error: 'Parada ja finalizada' }, { status: 400 })
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
