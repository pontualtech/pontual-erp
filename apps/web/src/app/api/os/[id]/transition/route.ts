import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

type Params = { params: { id: string } }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const { toStatusId, notes, payment_method, installment_count: rawInstallmentCount, technician_id: bodyTechnicianId } = await req.json()
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

    // If target is a final status (Entregue) and OS has a total, require payment_method
    const isFinalDelivery = toStatus.is_final && toStatus.name !== 'Cancelada' && (os.total_cost ?? 0) > 0
    if (isFinalDelivery && !payment_method) {
      return error('Forma de pagamento é obrigatória para finalizar a OS', 400)
    }

    // Se status destino é "Pronta", exigir técnico atribuído
    const isPronta = toStatus.name.toLowerCase().includes('pronta')
    const effectiveTechnicianId = os.technician_id || bodyTechnicianId || null
    if (isPronta && !effectiveTechnicianId) {
      return error('É obrigatório atribuir um técnico antes de marcar como Pronta', 400)
    }

    // Execute transition
    const updateData: any = {
      status_id: toStatusId,
      ...(toStatus.is_final ? { actual_delivery: new Date() } : {}),
    }

    // Se Pronta, atualizar data de execução e técnico
    if (isPronta) {
      updateData.actual_delivery = new Date()
      if (bodyTechnicianId && !os.technician_id) {
        updateData.technician_id = bodyTechnicianId
      }
    }

    const [updated] = await prisma.$transaction([
      prisma.serviceOrder.update({
        where: { id: params.id },
        data: updateData,
        include: { customers: true },
      }),
      prisma.serviceOrderHistory.create({
        data: {
          company_id: user.companyId,
          service_order_id: params.id,
          from_status_id: os.status_id,
          to_status_id: toStatusId,
          changed_by: user.id,
          notes: notes || null,
        },
      }),
    ])

    // Notificar atendentes quando OS fica "Pronta"
    if (isPronta) {
      const osNum = String(os.os_number).padStart(4, '0')
      const customerName = os.customers?.legal_name || 'Cliente'
      const techProfile = os.technician_id
        ? await prisma.userProfile.findFirst({ where: { id: os.technician_id }, select: { name: true } })
        : null
      const techName = techProfile?.name || 'Não atribuído'
      const equipDesc = [os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' ')

      await prisma.announcement.create({
        data: {
          company_id: user.companyId,
          title: `🔧 OS-${osNum} PRONTA para entrega`,
          message: `A OS-${osNum} do cliente ${customerName} (${equipDesc}) foi concluída pelo técnico ${techName} e está pronta para entrega/retirada.`,
          priority: 'IMPORTANTE',
          require_read: true,
          author_name: 'Sistema',
          created_by: user.id,
        },
      })
    }

    // Auto-create AccountReceivable when delivering (final status, not cancelled)
    if (isFinalDelivery) {
      // Find "Venda de Servicos" category or first receita category
      const category = await prisma.category.findFirst({
        where: {
          company_id: user.companyId,
          module: 'financeiro_receita',
        },
        orderBy: { name: 'asc' },
      })

      const totalAmount = os.total_cost ?? 0
      let cardFeeTotal = 0
      let netAmount = totalAmount
      let daysToReceive = 0
      const isCard = payment_method && (payment_method.includes('Cartão') || payment_method.includes('Credito') || payment_method.includes('Crédito'))

      // Look up card fee config if paying by card
      if (isCard && installment_count >= 1) {
        const feeSettings = await prisma.setting.findMany({
          where: { company_id: user.companyId, key: { startsWith: 'card_fee.' } },
        })

        for (const setting of feeSettings) {
          try {
            const config = JSON.parse(setting.value)
            // Check if payment_method matches this config name
            if (payment_method.includes(config.name) || feeSettings.length === 1) {
              daysToReceive = config.days_to_receive || 30

              if (installment_count === 1 && payment_method.includes('Débito') && config.debit_fee_pct != null) {
                // Debit card
                cardFeeTotal = Math.round(totalAmount * config.debit_fee_pct / 100)
              } else if (Array.isArray(config.installments)) {
                // Credit card - find matching fee range
                for (const range of config.installments) {
                  if (installment_count >= range.from && installment_count <= range.to) {
                    cardFeeTotal = Math.round(totalAmount * range.fee_pct / 100)
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

      const receivable = await prisma.accountReceivable.create({
        data: {
          company_id: user.companyId,
          customer_id: os.customer_id,
          service_order_id: os.id,
          category_id: category?.id || null,
          description: `OS-${String(os.os_number).padStart(4, '0')} — ${os.equipment_type || 'Serviço'} ${os.equipment_brand || ''} ${os.equipment_model || ''}`.trim(),
          total_amount: totalAmount,
          received_amount: 0,
          due_date: new Date(),
          status: 'PENDENTE',
          payment_method: payment_method,
          installment_count: installment_count,
          card_fee_total: cardFeeTotal,
          net_amount: netAmount,
          notes: `Gerado automaticamente ao entregar OS-${String(os.os_number).padStart(4, '0')}`,
        },
      })

      // Create installment records if count > 1
      if (installment_count > 1) {
        const baseAmount = Math.floor(netAmount / installment_count)
        const remainder = netAmount - baseAmount * installment_count
        const installments = []
        const baseDate = new Date()

        for (let i = 0; i < installment_count; i++) {
          const dueDate = new Date(baseDate)
          if (i === 0) {
            dueDate.setDate(dueDate.getDate() + daysToReceive)
          } else {
            dueDate.setDate(dueDate.getDate() + daysToReceive + 30 * i)
          }
          installments.push({
            company_id: user.companyId,
            parent_type: 'RECEIVABLE',
            parent_id: receivable.id,
            installment_number: i + 1,
            amount: i === 0 ? baseAmount + remainder : baseAmount,
            due_date: dueDate,
            status: 'PENDENTE',
          })
        }

        await prisma.installment.createMany({ data: installments })
      }

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

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'os',
      action: 'transition',
      entityId: params.id,
      oldValue: { statusId: os.status_id },
      newValue: { statusId: toStatusId, notes, payment_method },
    })

    // Notify customer via Chatwoot (fire and forget)
    if (os.customers?.mobile || os.customers?.phone) {
      const phone = os.customers.mobile || os.customers.phone
      const statusName = toStatus.name
      const osNum = String(os.os_number).padStart(4, '0')
      fetch(`${process.env.NEXT_PUBLIC_APP_URL || ''}/api/integracoes/chatwoot/enviar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          message: `Olá! Sua OS-${osNum} foi atualizada para: *${statusName}*.\n\nAcompanhe pelo portal: ${process.env.NEXT_PUBLIC_APP_URL}/portal/pontualtech/login`
        })
      }).catch(() => {}) // fire and forget
    }

    return success({ ...updated, receivable_created: isFinalDelivery })
  } catch (err) {
    return handleError(err)
  }
}
