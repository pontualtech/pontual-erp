import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getPortalUserFromRequest } from '@/lib/portal-auth'
import { isAllowedOrigin } from '@/lib/csrf-origin'
import { canCustomerPayOS } from '@/lib/os-payment-rules'

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
    // Status visíveis no progresso do portal (timeline do cliente)
    const PORTAL_VISIBLE = ['coletar', 'orcar', 'aguardando aprov', 'aprovado', 'entregar reparado', 'entregue']

    // OS com coleta agendada (os_location=EXTERNO) ve "Coletar" (aguardando motorista buscar).
    // OS de balcao (os_location=LOJA, cliente traz) ve "Recebido" (ja chegou no laboratorio).
    // Internamente o status e o mesmo ('Coletar' — order=1), so muda o rotulo exibido.
    const isPickup = os.os_location === 'EXTERNO'
    const firstStepLabel = isPickup ? 'Coletar' : 'Recebido'

    // Mapeamento: status interno (lowercase) → nome que o cliente vê
    const PORTAL_LABEL: Record<string, string> = {
      'coletar': firstStepLabel,
      'orcar': 'Em Analise',
      'aguardando aprov': 'Aguardando Aprovacao',
      'aprovado': 'Em Reparo',
      'em execu': 'Em Reparo',
      'aguardando pe': 'Em Reparo',
      'entregar reparado': 'Pronto para Retirada',
      'entregar recusado': 'Pronto para Retirada',
      'entregue': 'Entregue',
      'cancelada': 'Cancelada',
    }
    const PORTAL_COLOR: Record<string, string> = {
      'coletar': '#7C3AED',
      'orcar': '#F59E0B',
      'aguardando aprov': '#EF4444',
      'aprovado': '#3B82F6',
      'em execu': '#3B82F6',
      'aguardando pe': '#F59E0B',
      'entregar reparado': '#10B981',
      'entregar recusado': '#10B981',
      'entregue': '#22C55E',
      'cancelada': '#6B7280',
    }

    const allDbStatuses = await prisma.moduleStatus.findMany({
      where: { company_id: portalUser.company_id, module: 'os' },
      orderBy: { order: 'asc' },
      select: { id: true, name: true, color: true, icon: true, order: true },
    })

    // Filtrar, mapear para nomes amigáveis, e DEDUPLICAR por nome
    const seen = new Set<string>()
    const allStatuses = allDbStatuses
      .filter(s => PORTAL_VISIBLE.some(v => s.name.toLowerCase().includes(v)))
      .map(s => {
        const matchKey = PORTAL_VISIBLE.find(v => s.name.toLowerCase().includes(v)) || ''
        return { ...s, name: PORTAL_LABEL[matchKey] || s.name, color: PORTAL_COLOR[matchKey] || s.color }
      })
      .filter(s => {
        if (seen.has(s.name)) return false
        seen.add(s.name)
        return true
      })

    // Mapear status atual da OS para o nome do portal.
    // IMPORTANTE: quando o status atual for um branch nao mapeado (Renegociar,
    // Entregar Recusado, Entregue Recusado, Laudo, etc), NAO mascarar como
    // "Em Reparo" — o cliente precisa saber que algo esta fora do fluxo.
    // Preservamos o nome original (em Title Case) para o frontend exibir no banner.
    const currentStatusName = os.module_statuses?.name || ''
    const { toTitleCase: tcStatus } = await import('@/lib/format-text')
    const currentKey = PORTAL_VISIBLE.find(v => currentStatusName.toLowerCase().includes(v))
    const fallbackKey = currentKey ? undefined : Object.keys(PORTAL_LABEL).find(k => currentStatusName.toLowerCase().includes(k))
    const portalStatus = currentKey
      ? { ...os.module_statuses, name: PORTAL_LABEL[currentKey] || currentStatusName, color: PORTAL_COLOR[currentKey] || os.module_statuses?.color }
      : fallbackKey
        ? { ...os.module_statuses, name: PORTAL_LABEL[fallbackKey], color: PORTAL_COLOR[fallbackKey] }
        : { ...os.module_statuses, name: tcStatus(currentStatusName), color: os.module_statuses?.color || '#F59E0B' }

    const { toTitleCase } = await import('@/lib/format-text')
    return NextResponse.json({
      data: {
        id: os.id,
        os_number: os.os_number,
        equipment_type: toTitleCase(os.equipment_type || ''),
        equipment_brand: toTitleCase(os.equipment_brand || ''),
        equipment_model: toTitleCase(os.equipment_model || ''),
        serial_number: os.serial_number,
        reported_issue: os.reported_issue,
        diagnosis: os.diagnosis,
        priority: os.priority,
        os_type: os.os_type,
        estimated_cost: os.estimated_cost,
        approved_cost: os.approved_cost,
        total_parts: os.total_parts,
        total_services: os.total_services,
        discount_amount: os.discount_amount ?? 0,
        total_cost: os.total_cost,
        custom_data: os.custom_data || {},
        is_recalculado: /recalculad/i.test(os.module_statuses?.name || ''),
        estimated_delivery: os.estimated_delivery,
        actual_delivery: os.actual_delivery,
        warranty_until: os.warranty_until,
        created_at: os.created_at,
        updated_at: os.updated_at,
        status: portalStatus,
        // can_pay: regra de negocio computada no backend usando o nome
        // INTERNO do status (currentStatusName), nao o label do portal.
        // Frontend apenas consome — single source of truth.
        can_pay: canCustomerPayOS(currentStatusName),
        items: os.service_order_items,
        history: os.service_order_history.map(h => {
          const rawStatus = h.module_statuses_service_order_history_to_status_idTomodule_statuses
          // Map internal status name to customer-friendly name
          const rawName = rawStatus?.name?.toLowerCase() || ''
          const friendlyKey = Object.keys(PORTAL_LABEL).find(k => rawName.includes(k))
          const friendlyName = friendlyKey ? PORTAL_LABEL[friendlyKey] : rawStatus?.name
          const friendlyColor = friendlyKey ? PORTAL_COLOR[friendlyKey] : rawStatus?.color
          return {
            id: h.id,
            to_status: rawStatus ? { ...rawStatus, name: friendlyName, color: friendlyColor } : rawStatus,
            notes: h.changed_by === 'CLIENTE' ? h.notes : null,
            created_at: h.created_at,
          }
        }),
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
    // Defense-in-depth CSRF: reject cross-origin POST (SameSite=Lax alone is
    // not enough — an XSS on a sibling subdomain could still forge this).
    if (!isAllowedOrigin(req)) {
      return NextResponse.json({ error: 'Origem nao autorizada' }, { status: 403 })
    }

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
        customers: { select: { legal_name: true } },
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

      // Calcular previsão de 10 dias úteis
      const estimatedDelivery = new Date()
      let diasUteis = 0
      while (diasUteis < 10) {
        estimatedDelivery.setDate(estimatedDelivery.getDate() + 1)
        const dow = estimatedDelivery.getDay()
        if (dow !== 0 && dow !== 6) diasUteis++
      }

      // Extrair forma de pagamento da mensagem (ex: "Aprovado pelo cliente — Pagamento: PIX")
      const paymentMatch = (message || '').match(/Pagamento:\s*(.+)/i)
      const paymentMethod = paymentMatch ? paymentMatch[1].trim() : null

      await prisma.$transaction([
        prisma.serviceOrder.update({
          where: { id: os.id },
          data: {
            status_id: approvedStatus.id,
            approved_cost: os.total_cost || os.estimated_cost,
            estimated_delivery: estimatedDelivery,
            payment_method: paymentMethod || os.payment_method,
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

      // Email + WhatsApp "Aprovacao Confirmada" pro cliente (fire-and-forget)
      ;(async () => {
        try {
          const { sendCompanyEmail } = await import('@/lib/send-email')
          const { sendWhatsAppCloud } = await import('@/lib/whatsapp/cloud-api')
          const { buildMagicLink: bml } = await import('@/lib/portal-magic-url')
          const company = await prisma.company.findUnique({
            where: { id: portalUser.company_id },
            select: { name: true, slug: true },
          })
          const customer = await prisma.customer.findUnique({
            where: { id: portalUser.customer_id },
            select: { id: true, legal_name: true, email: true, mobile: true, phone: true },
          })
          if (!company || !customer) return
          const ml = bml({ customerId: customer.id, companyId: portalUser.company_id, slug: company.slug, osId: os.id })
          const osNum = String(os.os_number).padStart(4, '0')
          const equipment = [os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' ') || 'Equipamento'
          const valorBRL = (Number(os.total_cost || os.estimated_cost || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
          const previsaoStr = estimatedDelivery.toLocaleDateString('pt-BR')
          const firstName = (customer.legal_name || 'Cliente').split(' ')[0]
          // WhatsApp texto livre (cliente acabou de interagir com portal — janela 24h)
          const phone = customer.mobile || customer.phone
          if (phone) {
            const msg = `Ola, ${firstName}! Recebemos sua aprovacao do orcamento.\n\n*OS #${osNum} aprovada*\nEquipamento: ${equipment}\nValor: ${valorBRL}\nPrevisao entrega: ${previsaoStr}\n\nVamos iniciar o reparo imediatamente. Acompanhar:\n${ml.url}\n\n_Equipe ${company.name}_`
            sendWhatsAppCloud(portalUser.company_id, phone, msg).catch(() => {})
          }
          // Email simples
          if (customer.email) {
            const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f5;padding:20px;">
              <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;">
                <div style="background:#15803d;padding:24px 32px;color:#fff;">
                  <h1 style="margin:0;font-size:20px;">${company.name}</h1>
                  <p style="margin:4px 0 0;font-size:14px;">Aprovacao Confirmada — OS #${osNum}</p>
                </div>
                <div style="padding:32px;">
                  <p>Ola, <strong>${customer.legal_name || 'Cliente'}</strong>!</p>
                  <p>Recebemos sua aprovacao do orcamento. Iniciaremos o reparo imediatamente.</p>
                  <table width="100%" cellpadding="8" style="background:#f9fafb;border-radius:6px;margin:16px 0;">
                    <tr><td>OS</td><td style="text-align:right;font-weight:bold;">#${osNum}</td></tr>
                    <tr><td>Equipamento</td><td style="text-align:right;">${equipment}</td></tr>
                    <tr><td>Valor aprovado</td><td style="text-align:right;font-weight:bold;color:#15803d;">${valorBRL}</td></tr>
                    <tr><td>Previsao entrega</td><td style="text-align:right;">${previsaoStr}</td></tr>
                  </table>
                  <a href="${ml.url}" style="display:block;text-align:center;background:#2563eb;color:#fff;padding:14px;border-radius:6px;text-decoration:none;font-weight:bold;">Acompanhar OS no portal</a>
                </div>
              </div>
            </body></html>`
            sendCompanyEmail(portalUser.company_id, customer.email, `Aprovacao confirmada — OS #${osNum} — ${company.name}`, html).catch(() => {})
          }
        } catch (e: any) {
          console.error('[portal/os approve notify]', e?.message)
        }
      })()

      return NextResponse.json({ data: { success: true, message: 'Orcamento aprovado!' } })
    }

    if (action === 'reject') {
      // Count previous rejections to determine 1st vs 2nd rejection
      const rejectionCount = await prisma.serviceOrderHistory.count({
        where: {
          service_order_id: os.id,
          OR: [
            { notes: { contains: 'RECUSADO pelo cliente' } },
            { notes: { contains: 'solicitou negociacao' } },
            { notes: { contains: 'recusar' } },
          ],
        },
      })
      const isSecondRejection = rejectionCount >= 1

      // Find target status based on rejection count
      let targetStatus
      if (isSecondRejection) {
        // 2nd+ rejection → "Renegociar" (requires admin intervention)
        targetStatus = await prisma.moduleStatus.findFirst({
          where: { company_id: portalUser.company_id, module: 'os', name: { contains: 'Renegociar', mode: 'insensitive' } },
        })
      }
      if (!targetStatus) {
        // 1st rejection → "Orçar Negociar"
        targetStatus = await prisma.moduleStatus.findFirst({
          where: { company_id: portalUser.company_id, module: 'os', name: { contains: 'Negociar', mode: 'insensitive' } },
        })
      }
      if (!targetStatus) {
        return NextResponse.json({ error: 'Status de negociacao nao configurado' }, { status: 500 })
      }

      // Save original_cost + rejection info in custom_data
      const customData = (os.custom_data || {}) as Record<string, any>
      if (!customData.original_cost && os.total_cost) {
        customData.original_cost = os.total_cost
      }
      customData.rejection_count = rejectionCount + 1
      customData.last_rejection_reason = message || null
      customData.last_rejection_at = new Date().toISOString()

      const osNum = String(os.os_number).padStart(4, '0')
      const customerName = os.customers?.legal_name || 'Cliente'

      await prisma.$transaction(async (tx) => {
        await tx.serviceOrder.update({
          where: { id: os.id },
          data: {
            status_id: targetStatus!.id,
            custom_data: customData,
            updated_at: new Date(),
          },
        })
        await tx.serviceOrderHistory.create({
          data: {
            company_id: portalUser.company_id,
            service_order_id: os.id,
            from_status_id: os.status_id,
            to_status_id: targetStatus!.id,
            changed_by: 'CLIENTE',
            notes: `Orcamento RECUSADO pelo cliente via portal${message ? ' — Motivo: ' + message : ''}`,
          },
        })
      })

      // Create internal announcement
      if (isSecondRejection) {
        // 2nd rejection: URGENT announcement for admin
        await prisma.announcement.create({
          data: {
            company_id: portalUser.company_id,
            title: `🔴 OS ${osNum} RECUSADA 2x — ADMIN DEVE INTERVIR — ${customerName}`,
            message: `O cliente ${customerName} recusou o orcamento da OS ${osNum} pela SEGUNDA VEZ.\n${message ? `Motivo: "${message}"\n` : ''}\n⚠️ STATUS: RENEGOCIAR — requer analise do administrador.\n\nACOES:\n• Administrador: analisar caso e decidir desconto maximo\n• Verificar se vale manter a negociacao\n• Se inviavel: agendar devolucao do equipamento`,
            priority: 'URGENTE',
            require_read: true,
            author_name: 'Sistema',
            created_by: 'portal',
          },
        })
      } else {
        // 1st rejection: notice for attendant
        await prisma.announcement.create({
          data: {
            company_id: portalUser.company_id,
            title: `❌ OS ${osNum} RECUSADA — ${customerName}`,
            message: `O cliente ${customerName} recusou/solicitou negociacao da OS ${osNum}.\n${message ? `Motivo: "${message}"\n` : ''}\nACOES NECESSARIAS:\n• Atendimento: entrar em contato para negociar\n• Verificar se ha custos a recuperar`,
            priority: 'URGENTE',
            require_read: true,
            author_name: 'Sistema',
            created_by: 'portal',
          },
        })
      }

      const responseMsg = isSecondRejection
        ? 'Recebemos sua decisao. O setor responsavel ja foi notificado e tomara as providencias necessarias.'
        : 'Solicitacao de negociacao enviada! Nossa equipe entrara em contato.'

      return NextResponse.json({ data: { success: true, message: responseMsg } })
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
