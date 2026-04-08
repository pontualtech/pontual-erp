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
    // Apenas estes status aparecem no progresso do portal
    const PORTAL_VISIBLE = ['coletar', 'orcar', 'aguardando aprov', 'aprovado', 'entregue']
    // Mapeamento: status interno → nome que o cliente vê
    const PORTAL_LABEL: Record<string, string> = {
      'coletar': 'Recebido',
      'orcar': 'Em Analise',
      'aguardando aprov': 'Aguardando Aprovacao',
      'aprovado': 'Em Reparo',
      'entregue': 'Entregue',
    }
    const PORTAL_COLOR: Record<string, string> = {
      'coletar': '#7C3AED',
      'orcar': '#F59E0B',
      'aguardando aprov': '#EF4444',
      'aprovado': '#3B82F6',
      'entregue': '#22C55E',
    }

    const allDbStatuses = await prisma.moduleStatus.findMany({
      where: { company_id: portalUser.company_id, module: 'os' },
      orderBy: { order: 'asc' },
      select: { id: true, name: true, color: true, icon: true, order: true },
    })

    // Filtrar e mapear para nomes amigáveis
    const allStatuses = allDbStatuses
      .filter(s => PORTAL_VISIBLE.some(v => s.name.toLowerCase().includes(v)))
      .map(s => {
        const matchKey = PORTAL_VISIBLE.find(v => s.name.toLowerCase().includes(v)) || ''
        return { ...s, name: PORTAL_LABEL[matchKey] || s.name, color: PORTAL_COLOR[matchKey] || s.color }
      })

    // Mapear status atual da OS para o nome do portal
    const currentStatusName = os.module_statuses?.name || ''
    const currentKey = PORTAL_VISIBLE.find(v => currentStatusName.toLowerCase().includes(v))
    // Se status não está nos visíveis, mapear: Em Execução/Aguardando Peça/etc → "Em Reparo"
    const portalStatus = currentKey
      ? { ...os.module_statuses, name: PORTAL_LABEL[currentKey] || currentStatusName, color: PORTAL_COLOR[currentKey] || os.module_statuses?.color }
      : { ...os.module_statuses, name: 'Em Reparo', color: '#3B82F6' }

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
