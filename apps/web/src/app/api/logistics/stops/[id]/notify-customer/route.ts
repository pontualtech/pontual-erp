import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { notifyCustomerOnTheWay } from '@/lib/visit-notification'
import { getDistanceAndDuration } from '@/lib/distance-matrix'

/**
 * POST /api/logistics/stops/[id]/notify-customer
 *
 * Permite ao atendente do ERP disparar a notificacao "tecnico a caminho"
 * pro cliente, sem depender do motorista clicar no app.
 *
 * Comportamento:
 *   1. Pega motorista da rota (pra usar nome real na mensagem)
 *   2. Calcula ETA via Routes API usando GPS atual do motorista (se houver)
 *   3. Reaproveita exatamente a mesma logica do app motorista
 *      (template Meta v3 -> v2 -> free text + pause bot)
 *
 * Permissao: os.edit (atendente, admin).
 *
 * Rate limit: 3 chamadas/h por stop (mesmo do endpoint motorista).
 * Se atendente e motorista chamarem juntos, contador compartilhado.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requirePermission('os', 'edit')
  if (auth instanceof NextResponse) return auth

  // Rate limit compartilhado com o /api/driver/stop/[id]/a-caminho
  // pra impedir spam mesmo se as duas vias forem usadas.
  const rl = rateLimit(`a-caminho:${params.id}`, 3, 60 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Cliente ja foi notificado recentemente' }, { status: 429 })
  }

  const stop = await prisma.logisticsStop.findFirst({
    where: { id: params.id, company_id: auth.companyId },
    include: {
      route: { select: {
        driver_id: true, last_lat: true, last_lng: true,
        driver: { select: { name: true } },
      }},
    },
  })
  if (!stop) return NextResponse.json({ error: 'Parada nao encontrada' }, { status: 404 })

  const driverName = stop.route.driver?.name || 'Tecnico'

  // ETA: tenta calcular via GPS do motorista + lat/lng da parada
  let etaMinutes: number | null = null
  if (stop.route.last_lat && stop.route.last_lng && stop.lat && stop.lng) {
    try {
      const eta = await getDistanceAndDuration(
        { lat: Number(stop.route.last_lat), lng: Number(stop.route.last_lng) },
        { lat: Number(stop.lat), lng: Number(stop.lng) },
      )
      etaMinutes = Math.ceil(eta.duration_s / 60)
    } catch {} // se Distance Matrix falhar, segue sem ETA
  }

  // Atendente passa por enforceDriverOwnership=null (admin sempre pode)
  const result = await notifyCustomerOnTheWay({
    stopId: params.id,
    companyId: auth.companyId,
    driverName,
    etaMinutes,
    enforceDriverOwnership: null,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status_code || 500 })
  }
  return NextResponse.json({ data: result.data })
}
