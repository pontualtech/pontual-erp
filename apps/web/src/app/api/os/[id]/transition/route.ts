import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { sendCompanyEmail } from '@/lib/send-email'
import { sendWhatsAppCloud, sendWhatsAppTemplate } from '@/lib/whatsapp/cloud-api'
import { whatsappTemplates, getTemplateForStatus } from '@/lib/whatsapp/templates'
import { createAccessToken } from '@/lib/portal-auth'

type Params = { params: { id: string } }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()
    const { toStatusId, notes, payment_method, installment_count: rawInstallmentCount, technician_id: bodyTechnicianId, notify_whatsapp, notify_email, _resend_notify_only, account_id: bodyAccountId } = body
    // Notification flags: default true for backward compat, but frontend can set false
    const shouldNotifyWhatsApp = notify_whatsapp !== false
    const shouldNotifyEmail = notify_email !== false
    const installment_count = Math.max(1, Math.min(120, parseInt(rawInstallmentCount) || 1))
    if (!toStatusId) return error('toStatusId é obrigatório', 400)

    // Load current OS with customer
    const os = await prisma.serviceOrder.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      include: { customers: true },
    })
    if (!os) return error('OS não encontrada', 404)

    // Validate target status
    const toStatus = await prisma.moduleStatus.findFirst({
      where: { id: toStatusId, company_id: user.companyId, module: 'os' },
    })
    if (!toStatus) return error('Status de destino não encontrado', 404)

    // ── RESEND ONLY: skip transition logic, just send notifications ──
    if (_resend_notify_only) {
      const currentStatus = await prisma.moduleStatus.findFirst({ where: { id: os.status_id, company_id: user.companyId, module: 'os' } })

      // Email — full professional template (same as normal transition)
      if (shouldNotifyEmail && os.customers?.email) {
        const statusMap: Record<string, string> = {
          'Coletar': 'Recebido', 'Orcar': 'Em Analise', 'Negociar': 'Em Analise', 'LAUDO': 'Em Analise',
          'Aguardando Aprovacao': 'Aguardando sua Aprovacao', 'Aprovado': 'Aprovado - Em Reparo',
          'Em Execucao': 'Reparo em Andamento', 'Aguardando Peca': 'Aguardando Pecas',
          'Entregar Reparado': 'Pronto para Retirada', 'Entregue': 'Entregue', 'Cancelada': 'Cancelada',
        }
        const friendlyFrom = currentStatus ? (statusMap[currentStatus.name] || currentStatus.name) : '—'
        const friendlyTo = statusMap[toStatus.name] || toStatus.name
        const osNum = String(os.os_number).padStart(4, '0')
        const { toTitleCase: toTitleCaseResend } = await import('@/lib/format-text')
        const equipment = toTitleCaseResend([os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' ') || 'Equipamento')
        const customerFirstName = toTitleCaseResend((os.customers.legal_name || 'Cliente').split(' ')[0])

        // Load company data for footer
        const emailSettings = await prisma.setting.findMany({ where: { company_id: user.companyId } }).catch(() => [])
        const cfg: Record<string, string> = {}
        for (const s of emailSettings) cfg[s.key] = s.value
        const companyData = await prisma.company.findUnique({ where: { id: user.companyId }, select: { name: true, slug: true } }).catch(() => null)
        const companyName = companyData?.name || cfg['company.name'] || 'Empresa'
        const companyPhone = cfg['company.phone'] || ''
        const companyEmail = cfg['company.email'] || ''
        const portalBase = process.env.PORTAL_URL || 'https://portal.pontualtech.com.br'
        const portalSlug = companyData?.slug || 'pontualtech'
        const portalUrl = `${portalBase}/portal/${portalSlug}/os/${os.id}`

        const emailHtml = buildOsStatusEmailHtml({
          customerFirstName, osNum, equipment, friendlyFrom, friendlyTo,
          companyName, companyPhone, companyEmail, portalUrl,
        })
        sendCompanyEmail(
          user.companyId,
          os.customers.email,
          `OS #${osNum} — ${friendlyTo} — ${companyName}`,
          emailHtml,
        ).catch(() => {})
      }

      // WhatsApp via Meta Cloud API template
      const customerPhone = os.customers?.mobile || os.customers?.phone
      if (shouldNotifyWhatsApp && customerPhone) {
        const { toTitleCase: toTitleCaseWaResend } = await import('@/lib/format-text')
        const resendOsNum = String(os.os_number).padStart(4, '0')
        const resendEquipment = toTitleCaseWaResend([os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' ') || 'Equipamento')
        void sendWhatsAppTemplate(user.companyId, customerPhone as string, 'pontualtech_status_os', 'pt_BR', [
          { type: 'body', parameters: [
            { type: 'text', text: resendOsNum },
            { type: 'text', text: toStatus.name },
            { type: 'text', text: resendEquipment },
          ] }
        ]).catch(() => {})
      }

      return success({ id: os.id, resent: true })
    }

    // Validate current status
    const currentStatus = await prisma.moduleStatus.findFirst({
      where: { id: os.status_id, company_id: user.companyId, module: 'os' },
    })
    if (!currentStatus) return error('Status atual inválido', 500)

    // Check allowed transitions
    const allowedTransitions: string[] = Array.isArray(currentStatus.transitions)
      ? currentStatus.transitions as string[]
      : []
    if (allowedTransitions.length > 0 && !allowedTransitions.includes(toStatusId)) {
      return error(`Transição não permitida: ${currentStatus.name} → ${toStatus.name}`, 422)
    }

    // Bloquear reversão de status final (Entregue, Cancelada) — só admin pode reverter
    if (currentStatus.is_final && !toStatus.is_final && user.roleName !== 'admin') {
      return error(`OS já foi finalizada (${currentStatus.name}). Apenas o administrador pode reverter o status.`, 422)
    }

    // If target is a final status (Entregue) and OS has a total, require payment_method
    // Skip payment requirement for cancel/refuse statuses (no payment expected)
    const isCancelOrRefuse = /cancel|recusad/i.test(toStatus.name)
    const isFinalDelivery = toStatus.is_final && !isCancelOrRefuse && (os.total_cost ?? 0) > 0
    if (isFinalDelivery && !payment_method) {
      return error('Forma de pagamento é obrigatória para finalizar a OS', 400)
    }

    // Bloquear duplicação de conta a receber — se já tem, não gerar outra
    if (isFinalDelivery) {
      const existingAR = await prisma.accountReceivable.findFirst({
        where: { service_order_id: os.id, company_id: user.companyId, deleted_at: null },
      })
      if (existingAR) {
        return error('Esta OS já possui uma conta a receber gerada. Não é possível gerar duplicata.', 422)
      }
    }

    const effectiveTechnicianId = os.technician_id || bodyTechnicianId || null
    const toNameLower = toStatus.name.toLowerCase()

    // Detectar status que exige técnico + data de execução:
    // "Entregar Reparado", "Pronta", ou qualquer status final de entrega
    const isReparado = toNameLower.includes('reparad') || toNameLower.includes('pronta')
    const exigeTecnico = isReparado || isFinalDelivery

    if (exigeTecnico && !effectiveTechnicianId) {
      return error('É obrigatório atribuir um técnico para esta transição', 400)
    }

    // Save original_cost when transitioning TO negotiation statuses
    // (Orçar Negociar, Negociar, Recusado) — this preserves the original value
    // before the attendant modifies items for recalculation
    const isToNegociar = /negociar|recusad/i.test(toStatus.name) && !/renegociar/i.test(toStatus.name)
    const isToRecalculado = /recalculad/i.test(toStatus.name)
    const shouldSaveOriginal = isToNegociar || isToRecalculado
    if (shouldSaveOriginal) {
      const customData = (os.custom_data || {}) as Record<string, any>
      if (!customData.original_cost && os.total_cost && os.total_cost > 0) {
        customData.original_cost = os.total_cost
        os.custom_data = customData
      }
    }

    // Execute transition
    const updateData: any = {
      status_id: toStatusId,
      ...(shouldSaveOriginal ? { custom_data: os.custom_data } : {}),
    }

    // Data de execução + técnico: ao marcar como reparado ou entrega final
    if (isReparado || isFinalDelivery) {
      updateData.actual_delivery = new Date()
      if (bodyTechnicianId) updateData.technician_id = bodyTechnicianId
    }

    // Se Aprovado, calcular previsão de N dias úteis (configurável, padrão 10)
    const isAprovado = toNameLower.includes('aprovado')
    if (isAprovado) {
      // Allow override from request body, else read from company setting, else default 10
      let defaultDays = 10
      const setting = await prisma.setting.findFirst({
        where: { company_id: user.companyId, key: 'os.default_business_days' },
      })
      if (setting?.value) defaultDays = parseInt(setting.value) || 10

      const targetDays = body.business_days ? Math.max(1, parseInt(body.business_days)) : defaultDays

      let diasUteis = 0
      const data = new Date()
      while (diasUteis < targetDays) {
        data.setDate(data.getDate() + 1)
        const dow = data.getDay()
        if (dow !== 0 && dow !== 6) diasUteis++ // pula sab/dom
      }
      updateData.estimated_delivery = data
    }

    // ====== TRANSAÇÃO ATÔMICA: OS + Histórico + Conta a Receber + Parcelas ======
    let receivableCreated = false

    const updated = await prisma.$transaction(async (tx) => {
      // 1. Atualizar OS
      const updatedOS = await tx.serviceOrder.update({
        where: { id: params.id, company_id: user.companyId },
        data: updateData,
        include: { customers: true },
      })

      // 2. Registrar histórico
      await tx.serviceOrderHistory.create({
        data: {
          company_id: user.companyId,
          service_order_id: params.id,
          from_status_id: os.status_id,
          to_status_id: toStatusId,
          changed_by: user.id,
          notes: notes || null,
        },
      })

      // 3. Auto-criar AccountReceivable quando é entrega final
      if (isFinalDelivery) {
        const category = await tx.category.findFirst({
          where: { company_id: user.companyId, module: 'financeiro_receita' },
          orderBy: { name: 'asc' },
        })

        // Buscar conta bancária padrão para esta forma de pagamento
        const defaultAccountSetting = await tx.setting.findFirst({
          where: { company_id: user.companyId, key: `account_default.${payment_method}` },
        })
        const defaultAccountId = bodyAccountId || defaultAccountSetting?.value || null

        const totalAmount = os.total_cost ?? 0
        let cardFeeTotal = 0
        let netAmount = totalAmount
        let daysToReceive = 0
        const pmLower = (payment_method || '').toLowerCase()
        const isCard = pmLower.includes('cart') || pmLower.includes('credito') || pmLower.includes('crédito') || pmLower.includes('debito') || pmLower.includes('débito')

        if (isCard && installment_count >= 1) {
          const feeSettings = await tx.setting.findMany({
            where: { company_id: user.companyId, key: { startsWith: 'card_fee.' } },
          })
          for (const setting of feeSettings) {
            try {
              const config = JSON.parse(setting.value)
              // Aceitar se: nome da forma inclui nome da operadora, OU só tem uma operadora cadastrada
              if (payment_method.includes(config.name) || feeSettings.length === 1) {
                const isDebit = pmLower.includes('debito') || pmLower.includes('débito')
                const debitPct = config.debit?.fee_pct ?? config.debit_fee_pct
                if (installment_count === 1 && isDebit && debitPct != null) {
                  // Débito: taxa fixa, recebe em D+1
                  cardFeeTotal = Math.round(totalAmount * debitPct / 100)
                  daysToReceive = config.debit?.days_to_receive ?? 1
                } else {
                  // Crédito: buscar faixa pela quantidade de parcelas
                  const ranges = config.credit?.installments || config.installments || []
                  for (const range of ranges) {
                    if (installment_count >= range.from && installment_count <= range.to) {
                      cardFeeTotal = Math.round(totalAmount * range.fee_pct / 100)
                      daysToReceive = range.days_to_receive ?? 1
                      break
                    }
                  }
                }
                netAmount = totalAmount - cardFeeTotal
                break
              }
            } catch { /* skip invalid config */ }
          }
        }

        // Data de vencimento: para cartão com recebimento rápido (D+1), vence amanhã
        // Para boleto/PIX/dinheiro, vence hoje (recebimento imediato)
        const dueDate = new Date()
        if (daysToReceive > 0) {
          // Calcular próximo dia útil
          let dias = 0
          while (dias < daysToReceive) {
            dueDate.setDate(dueDate.getDate() + 1)
            const dow = dueDate.getDay()
            if (dow !== 0 && dow !== 6) dias++
          }
        }

        const receivable = await tx.accountReceivable.create({
          data: {
            company_id: user.companyId,
            customer_id: os.customer_id,
            service_order_id: os.id,
            category_id: category?.id || null,
            description: `OS-${String(os.os_number).padStart(4, '0')} — ${os.equipment_type || 'Serviço'} ${os.equipment_brand || ''} ${os.equipment_model || ''}`.trim(),
            total_amount: totalAmount,
            received_amount: 0,
            due_date: dueDate,
            status: 'PENDENTE',
            payment_method: payment_method,
            installment_count: installment_count,
            card_fee_total: cardFeeTotal,
            net_amount: netAmount,
            notes: isCard
              ? `Cartao ${installment_count}x — Taxa ${totalAmount > 0 ? ((cardFeeTotal / totalAmount) * 100).toFixed(2) : '0.00'}% (R$ ${(cardFeeTotal / 100).toFixed(2)}) — Liquido R$ ${(netAmount / 100).toFixed(2)} — Recebe em D+${daysToReceive} — OS-${String(os.os_number).padStart(4, '0')}${defaultAccountId ? ` — Conta: ${defaultAccountId}` : ''}`
              : `Gerado automaticamente ao entregar OS-${String(os.os_number).padStart(4, '0')}${defaultAccountId ? ` — Conta: ${defaultAccountId}` : ''}`,
          },
        })

        // Parcelas — gerar para qualquer forma quando parcelado
        if (installment_count > 1) {
          const baseAmount = Math.floor(totalAmount / installment_count)
          const remainder = totalAmount - baseAmount * installment_count
          const installments = []
          const baseDate = new Date()
          // Intervalo entre parcelas: usar days_to_receive da config da operadora, ou 30 dias padrão
          const intervalDias = (isCard && daysToReceive > 0) ? daysToReceive : 30
          for (let i = 0; i < installment_count; i++) {
            const instDueDate = new Date(baseDate)
            instDueDate.setDate(instDueDate.getDate() + intervalDias * (i + 1))
            installments.push({
              company_id: user.companyId,
              parent_type: 'RECEIVABLE',
              parent_id: receivable.id,
              installment_number: i + 1,
              amount: i === 0 ? baseAmount + remainder : baseAmount,
              due_date: instDueDate,
              status: 'PENDENTE',
            })
          }
          await tx.installment.createMany({ data: installments })
        }

        // Taxa do cartão
        if (cardFeeTotal > 0) {
          const feeCategory = await tx.category.findFirst({
            where: { company_id: user.companyId, module: 'financeiro_despesa', name: { contains: 'Taxas de Cartao' } },
          })
          await tx.accountPayable.create({
            data: {
              company_id: user.companyId,
              category_id: feeCategory?.id || null,
              description: `Taxa cartão OS-${String(os.os_number).padStart(4, '0')} — ${payment_method} ${installment_count > 1 ? installment_count + 'x' : ''}`.trim(),
              total_amount: cardFeeTotal,
              paid_amount: 0,
              due_date: new Date(),
              status: 'PENDENTE',
              payment_method: 'Desconto automático',
            },
          })
        }

        receivableCreated = true

        logAudit({
          companyId: user.companyId,
          userId: user.id,
          module: 'financeiro',
          action: 'auto_receivable',
          entityId: params.id,
          newValue: {
            os_number: os.os_number,
            total_cost: os.total_cost,
            payment_method,
            installment_count,
            card_fee_total: cardFeeTotal,
            net_amount: netAmount,
            customer: os.customers?.legal_name,
          },
        })
      }

      return updatedOS
    })

    // ====== AUTO-NOTIFICATIONS (AUTO-1): registrar notas automáticas no histórico ======
    // Fire-and-forget: não bloqueia a resposta, erros são silenciados
    try {
      if (toNameLower.includes('aguardando aprov')) {
        // Orçamento enviado, aguardando aprovação do cliente
        await prisma.serviceOrderHistory.create({
          data: {
            company_id: user.companyId,
            service_order_id: os.id,
            to_status_id: toStatusId,
            changed_by: user.id,
            notes: '📋 Orçamento enviado automaticamente ao cliente — aguardando aprovação',
          },
        })
      }

      if (toNameLower.includes('pronto') || toNameLower.includes('reparad')) {
        // Equipamento pronto para retirada/entrega
        await prisma.serviceOrderHistory.create({
          data: {
            company_id: user.companyId,
            service_order_id: os.id,
            to_status_id: toStatusId,
            changed_by: user.id,
            notes: '🔧 Equipamento pronto — notificação de retirada/entrega pendente',
          },
        })
      }

      if (toNameLower.includes('entregue')) {
        // Entrega realizada
        await prisma.serviceOrderHistory.create({
          data: {
            company_id: user.companyId,
            service_order_id: os.id,
            to_status_id: toStatusId,
            changed_by: user.id,
            notes: '✅ Equipamento entregue ao cliente — OS finalizada',
          },
        })
      }

      if (toNameLower.includes('coleta') || toNameLower.includes('coletar')) {
        // Coleta agendada
        await prisma.serviceOrderHistory.create({
          data: {
            company_id: user.companyId,
            service_order_id: os.id,
            to_status_id: toStatusId,
            changed_by: user.id,
            notes: '🚚 Coleta agendada — logística será notificada',
          },
        })
        // Fire-and-forget: send full coleta notification (WhatsApp + Email + Chatwoot sync)
        const internalKey = process.env.INTERNAL_API_KEY || process.env.BOT_WEBHOOK_SECRET || ''
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://erp.pontualtech.work'
        fetch(`${appUrl}/api/os/${os.id}/notificar-coleta`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Key': internalKey,
            cookie: req.headers.get('cookie') || '',
          },
          body: JSON.stringify({ channels: ['whatsapp', 'email'] }),
          signal: AbortSignal.timeout(15000),
        }).catch(e => console.log('[Transition] Auto coleta notification failed (ignored):', e.message))
      }
    } catch (autoNotifErr) {
      // Silenciar erro — notificação automática não deve bloquear a transição
      console.error('[AUTO-NOTIFICATION] Erro ao registrar notificação automática:', autoNotifErr)
    }

    // ====== NOTIFICATION RULES: check if auto-notification is enabled for this status ======
    const notifRuleSetting = await prisma.setting.findUnique({
      where: { company_id_key: { company_id: user.companyId, key: `notif.rule.${toStatusId}` } },
    }).catch(() => null)

    // Default: 'manual' for new/unconfigured statuses (safe — admin must explicitly enable auto)
    let notifRule = { mode: 'manual' as string, email: true, whatsapp: true, email_subject: '', email_message: '', whatsapp_message: '' }
    if (notifRuleSetting?.value) {
      try { notifRule = { ...notifRule, ...JSON.parse(notifRuleSetting.value) } } catch {}
    }

    // If mode is 'off' or 'manual', skip automatic notifications
    const autoNotifEnabled = notifRule.mode === 'auto'
    const shouldSendEmail = shouldNotifyEmail && autoNotifEnabled && notifRule.email
    const shouldSendWhatsApp = shouldNotifyWhatsApp && autoNotifEnabled && notifRule.whatsapp

    // Fora da transação: notificações (fire and forget, não precisa ser atômica)
    if (isReparado) {
      const osNum = String(os.os_number).padStart(4, '0')
      const { toTitleCase: toTitleCaseReparado } = await import('@/lib/format-text')
      const customerName = toTitleCaseReparado(os.customers?.legal_name || 'Cliente')
      const techProfile = os.technician_id
        ? await prisma.userProfile.findFirst({ where: { id: os.technician_id }, select: { name: true } })
        : null
      const techName = techProfile?.name || 'Não atribuído'
      const equipDesc = toTitleCaseReparado([os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' '))

      prisma.announcement.create({
        data: {
          company_id: user.companyId,
          title: `🔧 OS-${osNum} PRONTA para entrega`,
          message: `A OS-${osNum} do cliente ${customerName} (${equipDesc}) foi concluída pelo técnico ${techName} e está pronta para entrega/retirada.`,
          priority: 'IMPORTANTE',
          require_read: true,
          author_name: 'Sistema',
          created_by: user.id,
        },
      }).catch(() => {}) // fire and forget
    }

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'os',
      action: 'transition',
      entityId: params.id,
      oldValue: { statusId: os.status_id },
      newValue: { statusId: toStatusId, notes, payment_method },
    })

    // Notify customer via WhatsApp Cloud API template (fire and forget)
    if (shouldSendWhatsApp && (os.customers?.mobile || os.customers?.phone)) {
      const phone = (os.customers.mobile || os.customers.phone) as string
      const statusName = toStatus.name
      const osNum = String(os.os_number).padStart(4, '0')
      const { toTitleCase: toTitleCaseWa1 } = await import('@/lib/format-text')
      const equipment = toTitleCaseWa1([os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' ') || 'Equipamento')

      // Send via template with buttons (works outside 24h window)
      sendWhatsAppTemplate(user.companyId, phone, 'pontualtech_status_os', 'pt_BR', [
        { type: 'body', parameters: [
          { type: 'text', text: osNum },
          { type: 'text', text: statusName },
          { type: 'text', text: equipment },
        ] }
      ]).catch(() => {})
    }

    // ====== EMAIL NOTIFICATION: notify customer of status change (fire-and-forget) ======
    if (shouldSendEmail && os.customers?.email) {
      const statusMap: Record<string, string> = {
        'Coletar': 'Recebido',
        'Orcar': 'Em Analise',
        'Negociar': 'Em Analise',
        'LAUDO': 'Em Analise',
        'Aguardando Aprovacao': 'Aguardando sua Aprovacao',
        'Aprovado': 'Aprovado - Em Reparo',
        'Em Execucao': 'Reparo em Andamento',
        'Aguardando Peca': 'Aguardando Pecas',
        'Entregar Reparado': 'Pronto para Retirada',
        'Entregue': 'Entregue',
        'Cancelada': 'Cancelada',
      }
      const friendlyFrom = statusMap[currentStatus.name] || currentStatus.name
      const friendlyTo = statusMap[toStatus.name] || toStatus.name

      const { toTitleCase: toTitleCaseEmail } = await import('@/lib/format-text')
      const customerFirstName = toTitleCaseEmail((os.customers.legal_name || 'Cliente').split(' ')[0])
      const osNum = String(os.os_number).padStart(4, '0')
      const equipment = toTitleCaseEmail([os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' ') || 'Equipamento')

      // Load company settings for footer
      const emailSettings = await prisma.setting.findMany({ where: { company_id: user.companyId } }).catch(() => [])
      const cfg: Record<string, string> = {}
      for (const s of emailSettings) cfg[s.key] = s.value
      const companyName = os.customers?.company_id ? (await prisma.company.findUnique({ where: { id: user.companyId }, select: { name: true } }).catch(() => null))?.name || cfg['company.name'] || 'Empresa' : cfg['company.name'] || 'Empresa'
      const companyPhone = cfg['company.phone'] || ''
      const companyEmail = cfg['company.email'] || ''
      const portalBase = process.env.PORTAL_URL || 'https://portal.pontualtech.com.br'
      const company = await prisma.company.findFirst({ where: { id: user.companyId }, select: { slug: true } })
      const portalSlug = company?.slug || 'pontualtech'
      const portalUrl = `${portalBase}/portal/${portalSlug}/os/${os.id}`

      const emailHtml = buildOsStatusEmailHtml({
        customerFirstName, osNum, equipment, friendlyFrom, friendlyTo,
        companyName, companyPhone, companyEmail, portalUrl,
      })

      sendCompanyEmail(
        user.companyId,
        os.customers.email,
        `OS #${osNum} — ${friendlyTo} — ${companyName}`,
        emailHtml,
      ).catch(e => console.log('[Transition] Email notification failed (ignored):', e.message))
    }

    // WhatsApp notification via Evolution API (fire-and-forget) — respects notification rules
    const customerPhone = os.customers?.mobile || os.customers?.phone
    if (shouldSendWhatsApp && customerPhone) {
      const { toTitleCase: toTitleCaseWa } = await import('@/lib/format-text')
      const customerFirstName = toTitleCaseWa((os.customers?.legal_name || 'Cliente').split(' ')[0])
      const osNum = String(os.os_number).padStart(4, '0')
      const equipment = toTitleCaseWa([os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' ') || 'Equipamento')

      // Always use Meta Cloud API template for WhatsApp (works outside 24h window)
      void sendWhatsAppTemplate(user.companyId, customerPhone, 'pontualtech_status_os', 'pt_BR', [
        { type: 'body', parameters: [
          { type: 'text', text: osNum },
          { type: 'text', text: toStatus.name },
          { type: 'text', text: equipment },
        ] }
      ]).catch(e =>
        console.log('[Transition] WhatsApp template notification failed (ignored):', e)
      )
    }

    return success({ ...updated, receivable_created: receivableCreated })
  } catch (err) {
    return handleError(err)
  }
}

// ── Reusable email HTML builder for OS status notifications ──
function buildOsStatusEmailHtml(p: {
  customerFirstName: string
  osNum: string
  equipment: string
  friendlyFrom: string
  friendlyTo: string
  companyName: string
  companyPhone: string
  companyEmail: string
  portalUrl: string
}): string {
  const statusMessages: Record<string, string> = {
    'Recebido': 'Recebemos seu equipamento! Em breve iniciaremos a analise.',
    'Em Analise': 'Nossos tecnicos estao analisando seu equipamento.',
    'Aguardando sua Aprovacao': 'Enviamos o orcamento para sua aprovacao. Confira os detalhes no portal.',
    'Aprovado - Em Reparo': 'Orcamento aprovado! O reparo ja foi iniciado.',
    'Reparo em Andamento': 'O reparo do seu equipamento esta em andamento.',
    'Aguardando Pecas': 'Estamos aguardando a chegada de pecas para continuar o reparo.',
    'Pronto para Retirada': 'Seu equipamento esta pronto! Entre em contato para retirar.',
    'Entregue': 'Seu equipamento foi entregue. Obrigado pela confianca!',
    'Cancelada': 'Esta ordem de servico foi cancelada.',
  }
  const statusMsg = statusMessages[p.friendlyTo] || `Status atualizado para: ${p.friendlyTo}`
  const badgeColor = p.friendlyTo.includes('Pronto') ? '#16a34a' : p.friendlyTo.includes('Cancelada') ? '#dc2626' : p.friendlyTo.includes('Aguardando') ? '#f59e0b' : '#2563eb'

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr><td style="background:linear-gradient(135deg,#1e40af 0%,#2563eb 50%,#3b82f6 100%);padding:32px;text-align:center;">
          <h1 style="margin:0 0 4px;color:#fff;font-size:20px;font-weight:800;">Atualizacao da sua OS</h1>
          <p style="margin:0;color:rgba(255,255,255,0.7);font-size:12px;">${p.companyName}</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="font-size:16px;margin:0 0 16px;color:#1e293b;">Ola <strong>${p.customerFirstName}</strong>,</p>
          <p style="font-size:14px;color:#475569;margin:0 0 24px;line-height:1.6;">Sua OS <strong>#${p.osNum}</strong> teve uma atualizacao!</p>
          <div style="background:#f8fafc;border:2px solid #e2e8f0;border-radius:10px;padding:16px;margin:0 0 20px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#1e293b;">
              <tr><td style="padding:6px 0;color:#64748b;font-weight:700;width:120px;">Equipamento:</td><td style="padding:6px 0;font-weight:600;">${p.equipment}</td></tr>
              <tr><td style="padding:6px 0;color:#64748b;font-weight:700;">OS:</td><td style="padding:6px 0;font-weight:600;">#${p.osNum}</td></tr>
              <tr><td style="padding:6px 0;color:#64748b;font-weight:700;">Status:</td><td style="padding:6px 0;">
                <span style="background:#94a3b8;color:#fff;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;">${p.friendlyFrom}</span>
                <span style="margin:0 6px;color:#64748b;">&#8594;</span>
                <span style="background:${badgeColor};color:#fff;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;">${p.friendlyTo}</span>
              </td></tr>
            </table>
          </div>
          <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:14px;margin:0 0 24px;">
            <p style="margin:0;font-size:14px;color:#1e40af;line-height:1.5;">${statusMsg}</p>
          </div>
          <div style="text-align:center;margin:0 0 8px;">
            <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td style="background:#2563eb;border-radius:8px;">
              <a href="${p.portalUrl}" style="display:inline-block;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:14px 32px;">VER MINHA OS</a>
            </td></tr></table>
          </div>
        </td></tr>
        <tr><td style="background:#1e293b;padding:24px 32px;text-align:center;">
          <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#fff;">${p.companyName}</p>
          ${p.companyPhone ? `<p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">Tel: ${p.companyPhone}</p>` : ''}
          ${p.companyEmail ? `<p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">${p.companyEmail}</p>` : ''}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
