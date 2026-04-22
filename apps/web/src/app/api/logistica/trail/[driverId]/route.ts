import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'

/**
 * GET /api/logistica/trail/[driverId]?date=YYYY-MM-DD
 *
 * Retorna todas as posicoes GPS de um motorista num dia (default: hoje),
 * ordenadas cronologicamente. Usado por:
 *   1. Desenhar polyline do trajeto no mapa /logistica/live
 *   2. Replay timeline (slider voltando no tempo)
 *
 * Retorna ate 5000 pontos por dia. Em volume tipico (1 ponto/10s, 8h),
 * isso cabe com folga (~2880 pontos). Se passar do limite, downsample
 * pegando 1 a cada N pra caber nos 5000.
 *
 * Permissao: logistica.view (admin/atendente do ERP).
 */
export async function GET(req: NextRequest, { params }: { params: { driverId: string } }) {
  const auth = await requirePermission('logistica', 'view')
  if (auth instanceof NextResponse) return auth

  const url = req.nextUrl.searchParams
  const dateStr = url.get('date') // YYYY-MM-DD em horario local (SP)
  let from: Date
  let to: Date
  if (dateStr) {
    // Trata como data brasileira: YYYY-MM-DD 00:00 SP -> UTC
    from = new Date(`${dateStr}T00:00:00-03:00`)
    to = new Date(`${dateStr}T23:59:59-03:00`)
  } else {
    from = new Date()
    from.setHours(0, 0, 0, 0)
    to = new Date(from)
    to.setHours(23, 59, 59, 999)
  }

  // Valida que motorista existe na empresa (evita vazamento cross-tenant)
  const driver = await prisma.userProfile.findFirst({
    where: { id: params.driverId, company_id: auth.companyId },
    select: { id: true, name: true },
  })
  if (!driver) return NextResponse.json({ error: 'Motorista nao encontrado' }, { status: 404 })

  const points = await prisma.driverLocationHistory.findMany({
    where: {
      driver_id: params.driverId,
      company_id: auth.companyId,
      captured_at: { gte: from, lte: to },
    },
    orderBy: { captured_at: 'asc' },
    take: 5000,
    select: { lat: true, lng: true, accuracy_m: true, captured_at: true },
  })

  return NextResponse.json({
    data: {
      driver: { id: driver.id, name: driver.name },
      from: from.toISOString(),
      to: to.toISOString(),
      total_points: points.length,
      points: points.map(p => ({
        lat: Number(p.lat),
        lng: Number(p.lng),
        accuracy_m: p.accuracy_m,
        at: p.captured_at,
      })),
    },
  })
}
