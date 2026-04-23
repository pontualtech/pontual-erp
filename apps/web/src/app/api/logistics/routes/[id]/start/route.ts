import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { requireDriver } from '@/lib/driver-auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { sendWhatsAppTemplate } from '@/lib/whatsapp/cloud-api'
import { pauseBotForLogistics } from '@/lib/bot/pause-for-logistics'

type Params = { params: { id: string } }

/**
 * POST /api/logistics/routes/[id]/start
 *
 * Inicia a rota. Opcionalmente dispara notificacao em massa pra
 * todos os clientes da rota avisando que o motorista saiu da base.
 *
 * Body: { notify_clients?: boolean }
 *   - Se omitido, usa setting logistics.notify_route_start (default true)
 *   - Se true, envia template pt_rota_iniciada_v1 em paralelo pra cada
 *     stop com telefone valido (nao bloqueia resposta)
 *
 * Aceita auth de atendente (os:edit) OU motorista da rota.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    let companyId: string | null = null
    let userId: string | null = null
    let actorName = 'Sistema'

    const perm = await requirePermission('os', 'edit').catch(() => null)
    if (perm && !(perm instanceof NextResponse)) {
      companyId = perm.companyId
      userId = perm.id
      actorName = (perm as any).name || 'Atendente'
    } else {
      const driver = await requireDriver()
      if (driver instanceof NextResponse) return driver
      companyId = driver.companyId
      userId = driver.id
      actorName = driver.name || 'Motorista'
    }
    if (!companyId) return error('Unauthorized', 401)

    const route = await prisma.logisticsRoute.findFirst({
      where: { id: params.id, company_id: companyId },
      include: {
        stops: { orderBy: { sequence: 'asc' } },
        driver: { select: { id: true, name: true } },
      },
    })
    if (!route) return error('Rota não encontrada', 404)

    // Motorista so pode iniciar a propria rota
    if (perm == null && route.driver_id && route.driver_id !== userId) {
      return error('Rota de outro motorista', 403)
    }

    if (route.status === 'IN_PROGRESS') return error('Rota já está em andamento', 422)
    if (route.status === 'COMPLETED') return error('Rota já foi concluída', 422)

    const body = await req.json().catch(() => ({}))

    // Setting da empresa (default true — notifica). Body sobrescreve.
    let notifyClients = true
    const setting = await prisma.setting.findFirst({
      where: { company_id: companyId, key: 'logistics.notify_route_start' },
    })
    if (setting) notifyClients = setting.value !== 'false'
    if (typeof body.notify_clients === 'boolean') notifyClients = body.notify_clients

    // Compare-and-set atomico: so muda se status for PLANNED (nao ja
    // IN_PROGRESS). Evita race condition em 2 cliques simultaneos — se
    // 2 requests chegam juntas, so 1 passa no updateMany e dispara
    // notificacoes em massa. A outra recebe 0 rows e retorna conflito.
    const flipped = await prisma.logisticsRoute.updateMany({
      where: {
        id: params.id,
        company_id: companyId,
        status: { not: 'IN_PROGRESS' },
        started_at: null,
      },
      data: {
        status: 'IN_PROGRESS',
        started_at: new Date(),
        updated_at: new Date(),
      },
    })
    if (flipped.count === 0) {
      return error('Rota já está em andamento (detectado por outro dispositivo)', 422)
    }

    const updated = await prisma.logisticsRoute.findUnique({
      where: { id: params.id },
      include: {
        stops: { orderBy: { sequence: 'asc' } },
        driver: { select: { id: true, name: true } },
      },
    })
    if (!updated) return error('Rota desapareceu', 500)

    // Dispara notificacao em massa (fire-and-forget, nao bloqueia retorno)
    let notifiedCount = 0
    let notifyFailed = 0
    if (notifyClients) {
      const motoristaFirstName = (route.driver?.name || actorName).split(' ')[0]

      // Enriquecer stops com telefone via OS→customer
      const osIds = route.stops.map(s => s.os_id).filter(Boolean) as string[]
      const osList = osIds.length
        ? await prisma.serviceOrder.findMany({
            where: { id: { in: osIds }, company_id: companyId },
            select: { id: true, customers: { select: { legal_name: true, mobile: true, phone: true } } },
          })
        : []
      const osById = new Map(osList.map(o => [o.id, o]))

      // Deduplicar por telefone (cliente com 2+ stops recebe so 1 msg)
      const sent = new Set<string>()
      const sendPromises: Promise<void>[] = []
      for (const stop of route.stops) {
        const os = stop.os_id ? osById.get(stop.os_id) : null
        const rawPhone = (os?.customers?.mobile || os?.customers?.phone || stop.customer_phone || '').replace(/\D/g, '')
        if (!rawPhone || rawPhone.length < 10) { notifyFailed++; continue }
        if (sent.has(rawPhone)) continue
        sent.add(rawPhone)

        const name = stop.customer_name || os?.customers?.legal_name || 'Cliente'
        const firstName = name.split(' ')[0]
        const normalizedPhone = rawPhone.startsWith('55') ? rawPhone : `55${rawPhone}`
        const fallback = `Ola, ${firstName}! Nosso motorista ${motoristaFirstName} acabou de sair da base e esta em rota. Em breve avisaremos quando estiver chegando.`

        sendPromises.push(
          sendWhatsAppTemplate(
            companyId!, normalizedPhone, 'pt_rota_iniciada_v1', 'pt_BR',
            [{
              type: 'body',
              parameters: [
                { type: 'text', text: firstName },
                { type: 'text', text: motoristaFirstName },
              ],
            }],
            fallback,
          ).then(r => {
            if (r.success) {
              notifiedCount++
              // Pausa bot nessa conversa — cliente responde? humano atende.
              void pauseBotForLogistics(companyId!, rawPhone, 'route-start').catch(() => {})
            } else notifyFailed++
          }).catch(() => { notifyFailed++ })
        )
      }
      // Aguarda em background — mas NAO mais de 15s, pra nao travar o POST
      await Promise.race([
        Promise.all(sendPromises),
        new Promise(resolve => setTimeout(resolve, 15_000)),
      ])
    }

    logAudit({
      companyId,
      userId: userId!,
      module: 'logistics',
      action: 'start_route',
      entityId: params.id,
      newValue: { notifiedCount, notifyFailed, notifyClients } as any,
    })

    return success({
      ...updated,
      notified_clients: notifiedCount,
      notify_failed: notifyFailed,
      notify_enabled: notifyClients,
    })
  } catch (err) {
    return handleError(err)
  }
}
