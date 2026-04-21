import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireDriver } from '@/lib/driver-auth'
import { getNextOsNumber } from '@/lib/os-number'

/**
 * POST /api/driver/stop/[id]/extra-os
 *
 * Motorista chegou numa coleta e o cliente entregou mais equipamentos
 * que nao estavam cadastrados. Esse endpoint:
 *   1. Cria nova OS pro MESMO cliente da parada atual
 *   2. Status inicial = "Coletar" (igual OS criada como EXTERNO)
 *   3. Adiciona nova LogisticsStop na MESMA rota do motorista,
 *      com sequence logo depois da parada atual
 *   4. Retorna new_os + new_stop_id pra UI
 *
 * Autoriza via requireDriver. Valida que a parada pertence a rota
 * do motorista (nao pode criar OS a partir de parada alheia).
 *
 * Body: {
 *   equipment_type: string    (obrigatorio)
 *   equipment_brand?: string
 *   equipment_model?: string
 *   serial_number?: string
 *   reported_issue: string    (obrigatorio)
 *   notes?: string
 * }
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireDriver()
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => ({}))
  const equipment_type = typeof body.equipment_type === 'string' ? body.equipment_type.trim() : ''
  const reported_issue = typeof body.reported_issue === 'string' ? body.reported_issue.trim() : ''
  if (!equipment_type) return NextResponse.json({ error: 'Informe o tipo do equipamento' }, { status: 400 })
  if (!reported_issue) return NextResponse.json({ error: 'Informe o problema relatado' }, { status: 400 })

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Busca a parada atual e valida que motorista e dono
      const stop = await tx.logisticsStop.findFirst({
        where: { id: params.id, company_id: auth.companyId },
        include: { route: { select: { id: true, driver_id: true } } },
      })
      if (!stop) throw new Error('NOT_FOUND')
      if (stop.route?.driver_id !== auth.id) throw new Error('FORBIDDEN')

      // 2. Pega customer_id da OS original (motorista so pode criar OS
      // extra pro cliente que ja ta visitando — evita criar OS "solta")
      let originalOs: { id: string; customer_id: string | null } | null = null
      if (stop.os_id) {
        originalOs = await tx.serviceOrder.findFirst({
          where: { id: stop.os_id, company_id: auth.companyId },
          select: { id: true, customer_id: true },
        })
      }
      const customerId = originalOs?.customer_id
      if (!customerId) throw new Error('NO_CUSTOMER')

      // 3. Resolve status "Coletar" (fallback pra is_default se nao existir)
      let initialStatus = await tx.moduleStatus.findFirst({
        where: {
          company_id: auth.companyId,
          module: 'os',
          name: { contains: 'Coletar', mode: 'insensitive' },
        },
      })
      if (!initialStatus) {
        initialStatus = await tx.moduleStatus.findFirst({
          where: { company_id: auth.companyId, module: 'os', is_default: true },
        })
      }
      if (!initialStatus) throw new Error('NO_STATUS')

      // 4. Lock + proximo numero
      const lockKey = Buffer.from(auth.companyId).reduce((acc, b) => acc + b, 0)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`
      const nextNumber = await getNextOsNumber(auth.companyId, tx as any)

      // 5. Cria nova OS
      const newOs = await tx.serviceOrder.create({
        data: {
          company_id: auth.companyId,
          os_number: nextNumber,
          customer_id: customerId,
          status_id: initialStatus.id,
          technician_id: auth.id, // motorista assume como responsavel ate atendente reatribuir
          priority: 'MEDIUM',
          os_type: 'AVULSO',
          os_location: 'EXTERNO',
          equipment_type,
          equipment_brand: body.equipment_brand || null,
          equipment_model: body.equipment_model || null,
          serial_number: body.serial_number || null,
          reported_issue,
          reception_notes: body.notes || 'Coletada em campo pelo motorista',
          internal_notes: `Criada via app motorista durante coleta da OS ${originalOs?.id || 'n/a'}`,
        },
      })

      // 6. Historico inicial
      await tx.serviceOrderHistory.create({
        data: {
          company_id: auth.companyId,
          service_order_id: newOs.id,
          to_status_id: initialStatus.id,
          changed_by: auth.id,
          notes: 'OS criada em campo pelo motorista durante visita',
        },
      })

      // 7. Adiciona LogisticsStop logo depois da parada atual. Usa
      // sequence = stop.sequence + 0.5 se schema permitir — mas sequence
      // e Int entao fazemos shift: todas as paradas depois da atual +1.
      // Alternativa: empurra a nova pro fim (sequence = max+1) pro
      // motorista ja continuar no mesmo endereco.
      const maxRow = await tx.logisticsStop.findFirst({
        where: { route_id: stop.route.id, company_id: auth.companyId },
        orderBy: { sequence: 'desc' },
        select: { sequence: true },
      })
      const newSeq = (maxRow?.sequence ?? 0) + 1

      const newStop = await tx.logisticsStop.create({
        data: {
          company_id: auth.companyId,
          route_id: stop.route.id,
          os_id: newOs.id,
          type: 'COLETA',
          sequence: newSeq,
          status: 'PENDING',
          customer_name: stop.customer_name,
          customer_phone: stop.customer_phone,
          address: stop.address,
          address_complement: stop.address_complement,
          lat: stop.lat,
          lng: stop.lng,
          notes: `Extra da OS original ${originalOs?.id ? '(' + originalOs.id + ')' : ''} — criada em campo`,
        },
      })

      // 8. Atualiza total_stops na rota
      await tx.logisticsRoute.update({
        where: { id: stop.route.id },
        data: { total_stops: { increment: 1 } },
      })

      return {
        os: { id: newOs.id, number: newOs.os_number },
        stop: { id: newStop.id, sequence: newStop.sequence },
      }
    })

    return NextResponse.json({ data: result }, { status: 201 })
  } catch (err: any) {
    if (err?.message === 'NOT_FOUND') return NextResponse.json({ error: 'Parada nao encontrada' }, { status: 404 })
    if (err?.message === 'FORBIDDEN') return NextResponse.json({ error: 'Parada nao pertence a sua rota' }, { status: 403 })
    if (err?.message === 'NO_CUSTOMER') return NextResponse.json({ error: 'Parada sem cliente vinculado' }, { status: 400 })
    if (err?.message === 'NO_STATUS') return NextResponse.json({ error: 'Empresa sem status inicial configurado' }, { status: 500 })
    console.error('extra-os error:', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
