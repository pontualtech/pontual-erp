import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getPortalUserFromRequest } from '@/lib/portal-auth'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const os = await prisma.serviceOrder.findFirst({
      where: {
        id: params.id,
        company_id: portalUser.company_id,
        customer_id: portalUser.customer_id,
        deleted_at: null,
      },
      include: {
        module_statuses: {
          select: { id: true, name: true, color: true, icon: true, order: true },
        },
        service_order_items: {
          where: { deleted_at: null },
          select: {
            id: true,
            item_type: true,
            description: true,
            quantity: true,
            unit_price: true,
            total_price: true,
          },
        },
        service_order_history: {
          orderBy: { created_at: 'asc' },
          include: {
            module_statuses_service_order_history_to_status_idTomodule_statuses: {
              select: { name: true, color: true, icon: true },
            },
          },
        },
        service_order_photos: {
          select: { id: true, url: true, label: true, created_at: true },
        },
      },
    })

    if (!os) {
      return NextResponse.json({ error: 'OS nao encontrada' }, { status: 404 })
    }

    // Buscar todos os status para a timeline
    // Ocultar status internos do progresso do cliente
    const HIDDEN_PORTAL_STATUSES = ['orcar', 'negociar', 'recalculado']
    const allStatuses = (await prisma.moduleStatus.findMany({
      where: { company_id: portalUser.company_id, module: 'os' },
      orderBy: { order: 'asc' },
      select: { id: true, name: true, color: true, icon: true, order: true },
    })).filter(s => !HIDDEN_PORTAL_STATUSES.some(h => s.name.toLowerCase().includes(h)))

    // Se OS está em status oculto, mapear para "Em Análise" no portal
    const currentStatusName = os.module_statuses?.name || ''
    const isHiddenStatus = HIDDEN_PORTAL_STATUSES.some(h => currentStatusName.toLowerCase().includes(h))
    const portalStatus = isHiddenStatus
      ? { ...os.module_statuses, name: 'Em Analise', color: '#F59E0B' }
      : os.module_statuses

    return NextResponse.json({
      data: {
        id: os.id,
        os_number: os.os_number,
        equipment_type: os.equipment_type,
        equipment_brand: os.equipment_brand,
        equipment_model: os.equipment_model,
        serial_number: os.serial_number,
        reported_issue: os.reported_issue,
        diagnosis: os.diagnosis,
        priority: os.priority,
        os_type: os.os_type,
        estimated_cost: os.estimated_cost,
        approved_cost: os.approved_cost,
        total_parts: os.total_parts,
        total_services: os.total_services,
        total_cost: os.total_cost,
        estimated_delivery: os.estimated_delivery,
        actual_delivery: os.actual_delivery,
        warranty_until: os.warranty_until,
        created_at: os.created_at,
        updated_at: os.updated_at,
        status: portalStatus,
        items: os.service_order_items,
        history: os.service_order_history.map(h => ({
          id: h.id,
          to_status: h.module_statuses_service_order_history_to_status_idTomodule_statuses,
          notes: h.notes,
          created_at: h.created_at,
        })),
        photos: os.service_order_photos,
        all_statuses: allStatuses,
      },
    })
  } catch (err) {
    console.error('[Portal OS Detail Error]', err)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { action, message } = await req.json()

    // Verificar que a OS pertence ao cliente
    const os = await prisma.serviceOrder.findFirst({
      where: {
        id: params.id,
        company_id: portalUser.company_id,
        customer_id: portalUser.customer_id,
        deleted_at: null,
      },
      include: {
        module_statuses: true,
      },
    })

    if (!os) {
      return NextResponse.json({ error: 'OS nao encontrada' }, { status: 404 })
    }

    if (action === 'approve') {
      // Verificar se status atual permite aprovacao
      const currentStatus = os.module_statuses.name.toLowerCase()
      if (!currentStatus.includes('aguardando') || !currentStatus.includes('aprov')) {
        return NextResponse.json(
          { error: 'Esta OS nao esta aguardando aprovacao' },
          { status: 400 }
        )
      }

      // Encontrar status "Aprovado"
      const approvedStatus = await prisma.moduleStatus.findFirst({
        where: {
          company_id: portalUser.company_id,
          module: 'os',
          name: { contains: 'Aprovado', mode: 'insensitive' },
        },
      })

      if (!approvedStatus) {
        return NextResponse.json(
          { error: 'Status "Aprovado" nao configurado' },
          { status: 500 }
        )
      }

      await prisma.$transaction([
        prisma.serviceOrder.update({
          where: { id: os.id },
          data: {
            status_id: approvedStatus.id,
            approved_cost: os.estimated_cost,
            updated_at: new Date(),
          },
        }),
        prisma.serviceOrderHistory.create({
          data: {
            company_id: portalUser.company_id,
            service_order_id: os.id,
            from_status_id: os.status_id,
            to_status_id: approvedStatus.id,
            changed_by: 'CLIENTE',
            notes: message || 'Orcamento aprovado pelo cliente via portal',
          },
        }),
      ])

      return NextResponse.json({ data: { success: true, message: 'Orcamento aprovado!' } })
    }

    if (action === 'reject') {
      // Encontrar status para negociacao
      const negotiateStatus = await prisma.moduleStatus.findFirst({
        where: {
          company_id: portalUser.company_id,
          module: 'os',
          name: { contains: 'Negociar', mode: 'insensitive' },
        },
      })

      if (!negotiateStatus) {
        return NextResponse.json(
          { error: 'Status de negociacao nao configurado' },
          { status: 500 }
        )
      }

      await prisma.$transaction([
        prisma.serviceOrder.update({
          where: { id: os.id },
          data: {
            status_id: negotiateStatus.id,
            updated_at: new Date(),
          },
        }),
        prisma.serviceOrderHistory.create({
          data: {
            company_id: portalUser.company_id,
            service_order_id: os.id,
            from_status_id: os.status_id,
            to_status_id: negotiateStatus.id,
            changed_by: 'CLIENTE',
            notes: message || 'Cliente solicitou negociacao via portal',
          },
        }),
      ])

      return NextResponse.json({ data: { success: true, message: 'Solicitacao de negociacao enviada!' } })
    }

    if (action === 'comment') {
      if (!message?.trim()) {
        return NextResponse.json({ error: 'Mensagem e obrigatoria' }, { status: 400 })
      }

      await prisma.serviceOrderHistory.create({
        data: {
          company_id: portalUser.company_id,
          service_order_id: os.id,
          from_status_id: os.status_id,
          to_status_id: os.status_id,
          changed_by: 'CLIENTE',
          notes: `[Comentario do cliente] ${message}`,
        },
      })

      return NextResponse.json({ data: { success: true, message: 'Comentario adicionado!' } })
    }

    return NextResponse.json({ error: 'Acao invalida' }, { status: 400 })
  } catch (err) {
    console.error('[Portal OS Action Error]', err)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
