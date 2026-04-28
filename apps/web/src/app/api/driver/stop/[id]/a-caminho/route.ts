import { NextRequest, NextResponse } from 'next/server'
import { requireDriver } from '@/lib/driver-auth'
import { rateLimit } from '@/lib/rate-limit'
import { notifyCustomerOnTheWay } from '@/lib/visit-notification'

/**
 * POST /api/driver/stop/[id]/a-caminho
 * Body: { eta_minutes?: number }
 *
 * Acionado pelo motorista no app (botao "🚗 A caminho"). Delega toda
 * a logica pra notifyCustomerOnTheWay() que e compartilhada com o
 * endpoint do atendente (/api/logistics/stops/[id]/notify-customer).
 *
 * Mantemos AQUI: rate limit por stop (3/h pra evitar bombardear cliente
 * se motorista clicar varias vezes).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireDriver()
  if (auth instanceof NextResponse) return auth

  const rl = rateLimit(`a-caminho:${params.id}`, 3, 60 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Cliente ja foi notificado recentemente' }, { status: 429 })
  }

  const body = await req.json().catch(() => ({}))
  const etaMinutes = Number.isFinite(body.eta_minutes) ? Number(body.eta_minutes) : null

  const result = await notifyCustomerOnTheWay({
    stopId: params.id,
    companyId: auth.companyId,
    driverName: auth.name,
    etaMinutes,
    enforceDriverOwnership: { driverId: auth.id, isSuperAdmin: auth.isSuperAdmin },
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status_code || 500 })
  }
  return NextResponse.json({ data: result.data })
}
