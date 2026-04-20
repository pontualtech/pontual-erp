import { NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'

/**
 * GET /api/logistica/live
 *
 * Returns today's active routes with driver + current position + stops, for
 * the dashboard live tracking map. Polled every ~15s from the UI. Only
 * operators with `logistica.view` see anything.
 */
export async function GET() {
  const auth = await requirePermission('logistica', 'view')
  if (auth instanceof NextResponse) return auth

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  const routes = await prisma.logisticsRoute.findMany({
    where: {
      company_id: auth.companyId,
      date: { gte: today, lt: tomorrow },
    },
    include: {
      driver: { select: { id: true, name: true, avatar_url: true } },
      stops: {
        orderBy: { sequence: 'asc' },
        select: {
          id: true, sequence: true, type: true, status: true,
          customer_name: true, address: true,
          lat: true, lng: true, completed_at: true, failure_reason: true,
        },
      },
    },
  })

  return NextResponse.json({
    data: {
      routes: routes.map(r => ({
        id: r.id,
        status: r.status,
        total_stops: r.total_stops,
        completed_stops: r.completed_stops,
        started_at: r.started_at,
        completed_at: r.completed_at,
        driver: r.driver,
        last_location: r.last_lat && r.last_lng ? {
          lat: Number(r.last_lat),
          lng: Number(r.last_lng),
          at: r.last_location_at,
        } : null,
        stops: r.stops.map(s => ({
          id: s.id,
          sequence: s.sequence,
          type: s.type,
          status: s.status,
          customer_name: s.customer_name,
          address: s.address,
          lat: s.lat ? Number(s.lat) : null,
          lng: s.lng ? Number(s.lng) : null,
          completed_at: s.completed_at,
          failure_reason: s.failure_reason,
        })),
      })),
    },
  })
}
