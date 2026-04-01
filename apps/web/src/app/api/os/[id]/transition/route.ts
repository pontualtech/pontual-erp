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

    // Bloquear reversão de status final (Entregue, Fechada) para qualquer outro — só admin pode
    if (currentStatus.is_final && !toStatus.is_final) {
      return error(`OS já foi finalizada (${currentStatus.name}). Não é possível reverter o status.`, 422)
    }

    // If target is a final status (Entregue) and OS has a total, require payment_method
    const isFinalDelivery = toStatus.is_final && toStatus.name !== 'Cancelada' && (os.total_cost ?? 0) > 0
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

    // Execute transition
    const updateData: any = {
      status_id: toStatusId,
    }

    // Data de execução + técnico: ao marcar como reparado ou entrega final
    if (isReparado || isFinalDelivery) {
      updateData.actual_delivery = new Date()
      if (bodyTechnicianId) updateData.technician_id = bodyTechnicianId
    }

    // Se Aprovado, calcular previsão de 10 dias úteis
    const isAprovado = toNameLower.includes('aprovado')
    if (isAprovado) {
      let diasUteis = 0
      const data = new Date()
      while (diasUteis < 10) {
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
        where: { id: params.id },
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
              ? `Cartao ${installment_count}x — Taxa ${((cardFeeTotal / totalAmount) * 100).toFixed(2)}% (R$ ${(cardFeeTotal / 100).toFixed(2)}) — Liquido R$ ${(netAmount / 100).toFixed(2)} — Recebe em D+${daysToReceive} — OS-${String(os.os_number).padStart(4, '0')}`
              : `Gerado automaticamente ao entregar OS-${String(os.os_number).padStart(4, '0')}`,
          },
        })

        // Parcelas — só para boleto parcelado (não para cartão, onde a Rede paga tudo junto)
        if (installment_count > 1 && !isCard) {
          const baseAmount = Math.floor(totalAmount / installment_count)
          const remainder = totalAmount - baseAmount * installment_count
          const installments = []
          const baseDate = new Date()
          for (let i = 0; i < installment_count; i++) {
            const instDueDate = new Date(baseDate)
            instDueDate.setDate(instDueDate.getDate() + 30 * (i + 1))
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

    // Fora da transação: notificações (fire and forget, não precisa ser atômica)
    if (isReparado) {
      const osNum = String(os.os_number).padStart(4, '0')
      const customerName = os.customers?.legal_name || 'Cliente'
      const techProfile = os.technician_id
        ? await prisma.userProfile.findFirst({ where: { id: os.technician_id }, select: { name: true } })
        : null
      const techName = techProfile?.name || 'Não atribuído'
      const equipDesc = [os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' ')

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

    return success({ ...updated, receivable_created: receivableCreated })
  } catch (err) {
    return handleError(err)
  }
}
