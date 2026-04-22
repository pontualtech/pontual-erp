import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireDriver } from '@/lib/driver-auth'
import { findStatusByName } from '@/lib/module-status'
import { sendCompanyEmail } from '@/lib/send-email'

function fmtBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/**
 * Envia recibo do pagamento por e-mail pro cliente.
 * Fire-and-forget — falhas de SMTP nao quebram a entrega.
 */
async function sendReceiptEmail(
  companyId: string,
  osId: string,
  amountCents: number,
  method: string,
  signerName: string,
): Promise<void> {
  const os = await prisma.serviceOrder.findFirst({
    where: { id: osId, company_id: companyId },
    select: { os_number: true, customers: { select: { legal_name: true, email: true } } },
  })
  const email = os?.customers?.email
  if (!email) return
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } })
  const name = os.customers?.legal_name || 'Cliente'
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:540px;margin:0 auto;padding:20px">
      <div style="border-bottom:3px solid #4f46e5;padding-bottom:8px;margin-bottom:20px">
        <h2 style="margin:0;color:#111">Recibo de pagamento</h2>
        <p style="margin:0;color:#6b7280;font-size:12px">${company?.name || 'ERP'}</p>
      </div>
      <p>Ola, <strong>${name}</strong>,</p>
      <p>Confirmamos o pagamento recebido na entrega da OS <strong>#${os.os_number}</strong>:</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:6px 0;color:#6b7280">Valor pago</td><td style="padding:6px 0;text-align:right;font-weight:700;font-size:18px">${fmtBRL(amountCents)}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Forma</td><td style="padding:6px 0;text-align:right">${method}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Recebido por</td><td style="padding:6px 0;text-align:right">${signerName}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280">Data</td><td style="padding:6px 0;text-align:right">${new Date().toLocaleString('pt-BR')}</td></tr>
      </table>
      <p style="color:#6b7280;font-size:12px;margin-top:24px">
        Este e-mail serve como comprovante de recebimento. Dúvidas? Responda esta mensagem.
      </p>
    </div>
  `
  try {
    await sendCompanyEmail(companyId, email, `Recibo de pagamento — OS #${os.os_number}`, html)
  } catch (err) {
    console.warn('[driver/entrega] Recibo email falhou:', err instanceof Error ? err.message : String(err))
  }
}

type Body = {
  event_id: string
  status: 'entregue_aprovado' | 'recusado_sem_conserto'
  refusal_reason?: string | null
  signature_png_base64: string
  signer_name: string
  payment?: {
    method: 'pix' | 'dinheiro' | 'cartao_credito' | 'cartao_debito' | 'boleto'
    amount_cents: number
    installments?: number | null  // parcelas (so cartao_credito)
    receipt_photo_base64?: string | null
    notes?: string | null
  } | null
  location?: { lat: number; lng: number } | null
}

/**
 * POST /api/driver/stop/[id]/entrega
 *
 * Idempotent via event_id. Effects depending on `status`:
 *  - entregue_aprovado:
 *      → OS moves to status "Entregue"
 *      → Creates a Payment row (status=CONFIRMED, paid_at=now) tied to the
 *        OS. This is the baixa no "Contas a Receber" — the operator pode
 *        conciliar depois.
 *  - recusado_sem_conserto:
 *      → OS moves to "Negociar" (ou fallback "Cancelada") com reason
 *      → no payment created
 *
 * Method mapping: UI envia lowercase snake_case (pix, cartao_credito);
 * converto pra shape do Payment (PIX, CREDIT_CARD) que o financeiro usa.
 */
const PAYMENT_METHOD_MAP: Record<Body['payment'] extends infer P ? NonNullable<P extends { method: infer M } ? M : never> : never, string> = {
  pix: 'PIX',
  dinheiro: 'CASH',
  cartao_credito: 'CREDIT_CARD',
  cartao_debito: 'DEBIT_CARD',
  boleto: 'BOLETO',
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireDriver()
  if (auth instanceof NextResponse) return auth

  const body = (await req.json().catch(() => ({}))) as Partial<Body>
  const errs = validate(body)
  if (errs.length) return NextResponse.json({ error: errs.join(', ') }, { status: 400 })

  // Idempotency
  // Idempotencia: event_id tem unique constraint no DB — se ja existe
  // em ANY stop (completed_at preenchido ou nao), retornamos 'already'.
  // Atomico: se duas requests concorrentes com mesmo event_id chegarem,
  // so 1 vai conseguir o compare-and-set do update abaixo.
  const byEvent = await prisma.logisticsStop.findUnique({
    where: { event_id: body.event_id! },
    select: { id: true, completed_at: true, company_id: true },
  })
  if (byEvent) {
    if (byEvent.company_id !== auth.companyId) {
      return NextResponse.json({ error: 'event_id em conflito' }, { status: 409 })
    }
    if (byEvent.id !== params.id) {
      return NextResponse.json({ error: 'event_id em conflito com outra parada' }, { status: 409 })
    }
    if (byEvent.completed_at) {
      return NextResponse.json({ data: { id: byEvent.id, already_completed: true } })
    }
  }

  const stop = await prisma.logisticsStop.findFirst({
    where: { id: params.id, company_id: auth.companyId, type: 'ENTREGA' },
    include: { route: { select: { driver_id: true } } },
  })
  if (!stop) return NextResponse.json({ error: 'Entrega nao encontrada' }, { status: 404 })
  if (stop.route.driver_id && stop.route.driver_id !== auth.id && !auth.isSuperAdmin) {
    return NextResponse.json({ error: 'Entrega atribuida a outro motorista' }, { status: 403 })
  }

  const isApproved = body.status === 'entregue_aprovado'
  const isRefused = body.status === 'recusado_sem_conserto'

  // Extra validation specific to outcome
  if (isRefused && !body.refusal_reason?.trim())
    return NextResponse.json({ error: 'Motivo da recusa obrigatorio' }, { status: 400 })
  if (isApproved && !body.payment)
    return NextResponse.json({ error: 'Forma de pagamento obrigatoria' }, { status: 400 })

  // Resolve target OS status
  let targetStatusName: string
  if (isApproved) targetStatusName = 'Entregue'
  else targetStatusName = 'Negociar' // recusa — backoffice decide próximo passo

  // Match tolerante: Imprimitech usa "Entregue Reparado"/"Entregue Recusado"
  // (order-specific) enquanto PontualTech pode usar so "Entregue"/"Negociar".
  // Tenta nomes especificos primeiro, depois generico.
  let targetStatus = stop.os_id
    ? await findStatusByName(
        auth.companyId, 'os',
        ...(isApproved
          ? ['Entregue', 'Entregue Reparado', 'Entregar Reparado']
          : ['Negociar', 'Entregue Recusado', 'Entregar Recusado']),
      )
    : null
  if (!targetStatus && isRefused && stop.os_id) {
    targetStatus = await findStatusByName(auth.companyId, 'os', 'Cancelada', 'Cancelado')
  }

  // Atualiza stop
  const photoUrls: string[] = [`data:image/png;base64,${body.signature_png_base64!}`]
  if (body.payment?.receipt_photo_base64)
    photoUrls.push(`data:image/jpeg;base64,${body.payment.receipt_photo_base64}`)

  // Compare-and-set: so consegue atualizar se completed_at ainda for
  // NULL. Se 2 requests concorrentes tentarem finalizar a mesma entrega,
  // a segunda recebe P2025 (no record found) e retorna already_completed.
  try {
    await prisma.logisticsStop.update({
      where: { id: params.id, completed_at: null } as any,
      data: {
        status: isApproved ? 'COMPLETED' : 'FAILED',
        completed_at: new Date(),
        signature_url: `data:image/png;base64,${body.signature_png_base64!}`,
        signer_name: body.signer_name!,
        event_id: body.event_id!,
        failure_reason: isRefused ? body.refusal_reason!.trim() : null,
        payment_method: isApproved ? body.payment!.method : null,
        payment_amount_cents: isApproved ? body.payment!.amount_cents : null,
        payment_receipt_url: body.payment?.receipt_photo_base64
          ? `data:image/jpeg;base64,${body.payment.receipt_photo_base64}`
          : null,
        completed_lat: body.location?.lat ?? null,
        completed_lng: body.location?.lng ?? null,
        photo_urls: photoUrls as any,
      },
    })
  } catch (err: any) {
    if (err?.code === 'P2025') {
      return NextResponse.json({ data: { id: params.id, already_completed: true } })
    }
    throw err
  }

  // Incrementa completed_stops da rota
  await prisma.logisticsRoute.updateMany({
    where: { id: stop.route_id },
    data: { completed_stops: { increment: 1 } },
  })

  // Transition OS + (se aprovado) criar Payment + AR atomicamente.
  // OS deletada (deleted_at) e ignorada pra nao criar lancamento fantasma.
  if (stop.os_id && targetStatus) {
    try {
      const os = await prisma.serviceOrder.findFirst({
        where: { id: stop.os_id, company_id: auth.companyId, deleted_at: null },
        select: { id: true, os_number: true, customer_id: true, total_cost: true },
      })
      if (os) {
        const shouldCreateFinancial = isApproved && body.payment!.amount_cents > 0
        const amount = shouldCreateFinancial ? body.payment!.amount_cents : 0
        const paymentMethodMapped = shouldCreateFinancial ? PAYMENT_METHOD_MAP[body.payment!.method] : ''
        const installmentCount = shouldCreateFinancial ? Math.max(1, Number(body.payment!.installments || 1)) : 1

        // Idempotencia do AR: checa se ja existe AR vinculada a OS + event_id.
        // Usa description pra carregar o event_id (nao tem campo dedicado).
        const arDescription = shouldCreateFinancial
          ? `Entrega OS #${os.os_number} — ${body.payment!.method} [event:${body.event_id}]`
          : ''

        const txOps: any[] = [
          prisma.serviceOrder.update({
            where: { id: os.id },
            data: {
              status_id: targetStatus.id,
              ...(isApproved ? { actual_delivery: new Date() } : {}),
            },
          }),
          prisma.serviceOrderHistory.create({
            data: {
              company_id: auth.companyId,
              service_order_id: os.id,
              to_status_id: targetStatus.id,
              changed_by: auth.id,
              notes: isApproved
                ? `Entrega finalizada por ${auth.name} — pagamento: ${body.payment!.method}`
                : `Recusada pelo cliente — ${body.refusal_reason!.trim()}`,
            },
          }),
        ]

        if (shouldCreateFinancial) {
          // Payment tem idempotency_key unique — retry seguro
          txOps.push(prisma.payment.upsert({
            where: { idempotency_key: `driver-${body.event_id}` },
            update: {},
            create: {
              company_id: auth.companyId,
              service_order_id: os.id,
              customer_id: os.customer_id,
              provider: 'driver_app',
              idempotency_key: `driver-${body.event_id}`,
              amount,
              status: 'CONFIRMED',
              method: paymentMethodMapped,
              billing_type: paymentMethodMapped,
              paid_at: new Date(),
            },
          }))
        }

        try {
          await prisma.$transaction(txOps)
        } catch (err) {
          console.warn('[driver/entrega] transaction falhou:', err instanceof Error ? err.message : String(err))
          throw err
        }

        if (shouldCreateFinancial) {
          // AR: pix/dinheiro/boleto = PAGO (recebido no ato).
          //     cartao_credito/debito = PENDENTE + installments + card_fee
          //     (valor so liquida apos D+N da operadora).
          // Igual ao que o atendente faz em /api/os/[id]/transition.
          const pmLower = (body.payment!.method || '').toLowerCase()
          const isCard = pmLower.includes('cart')
          try {
            const existingAR = await prisma.accountReceivable.findFirst({
              where: {
                company_id: auth.companyId,
                service_order_id: os.id,
                description: { contains: `[event:${body.event_id}]` },
              },
              select: { id: true },
            })
            if (!existingAR) {
              // Calcula card_fee via setting card_fee.* da empresa
              let cardFeeTotal = 0
              let netAmount = amount
              let daysToReceive = 0
              if (isCard) {
                const feeSettings = await prisma.setting.findMany({
                  where: { company_id: auth.companyId, key: { startsWith: 'card_fee.' } },
                })
                for (const setting of feeSettings) {
                  try {
                    const cfg = JSON.parse(setting.value)
                    if (pmLower.includes(String(cfg.name || '').toLowerCase()) || feeSettings.length === 1) {
                      const isDebit = pmLower.includes('debito') || pmLower.includes('débito')
                      const debitPct = cfg.debit?.fee_pct ?? cfg.debit_fee_pct
                      if (installmentCount === 1 && isDebit && debitPct != null) {
                        cardFeeTotal = Math.round(amount * debitPct / 100)
                        daysToReceive = cfg.debit?.days_to_receive ?? 1
                      } else {
                        const ranges = cfg.credit?.installments || cfg.installments || []
                        for (const range of ranges) {
                          if (installmentCount >= range.from && installmentCount <= range.to) {
                            cardFeeTotal = Math.round(amount * range.fee_pct / 100)
                            daysToReceive = range.days_to_receive ?? 1
                            break
                          }
                        }
                      }
                      netAmount = amount - cardFeeTotal
                      break
                    }
                  } catch { /* skip invalid */ }
                }
              }

              // Data de vencimento: hoje pra a vista, +D dias uteis pra cartao
              const dueDate = new Date()
              if (daysToReceive > 0) {
                let dias = 0
                while (dias < daysToReceive) {
                  dueDate.setDate(dueDate.getDate() + 1)
                  const dow = dueDate.getDay()
                  if (dow !== 0 && dow !== 6) dias++
                }
              }

              const ar = await prisma.accountReceivable.create({
                data: {
                  company_id: auth.companyId,
                  customer_id: os.customer_id,
                  service_order_id: os.id,
                  description: arDescription,
                  total_amount: amount,
                  received_amount: isCard ? 0 : amount,
                  due_date: dueDate,
                  status: isCard ? 'PENDENTE' : 'PAGO',
                  payment_method: paymentMethodMapped,
                  installment_count: installmentCount,
                  card_fee_total: cardFeeTotal,
                  net_amount: netAmount,
                  notes: isCard
                    ? `Cartao ${installmentCount}x via motorista ${auth.name}. Taxa R$ ${(cardFeeTotal / 100).toFixed(2)}, Liquido R$ ${(netAmount / 100).toFixed(2)}, Recebe D+${daysToReceive}`
                    : `Recebido via motorista ${auth.name}`,
                },
              })

              // Parcelas (so quando > 1)
              if (installmentCount > 1) {
                const baseAmount = Math.floor(amount / installmentCount)
                const remainder = amount - baseAmount * installmentCount
                const intervalDias = (isCard && daysToReceive > 0) ? daysToReceive : 30
                const installments = []
                const baseDate = new Date()
                for (let i = 0; i < installmentCount; i++) {
                  const instDue = new Date(baseDate)
                  instDue.setDate(instDue.getDate() + intervalDias * (i + 1))
                  installments.push({
                    company_id: auth.companyId,
                    parent_type: 'RECEIVABLE',
                    parent_id: ar.id,
                    installment_number: i + 1,
                    amount: i === 0 ? baseAmount + remainder : baseAmount,
                    due_date: instDue,
                    status: 'PENDENTE',
                  })
                }
                await prisma.installment.createMany({ data: installments })
              }

              // Despesa da taxa do cartao (AccountPayable)
              if (cardFeeTotal > 0) {
                const feeCategory = await prisma.category.findFirst({
                  where: { company_id: auth.companyId, module: 'financeiro_despesa', name: { contains: 'Taxas de Cartao' } },
                })
                await prisma.accountPayable.create({
                  data: {
                    company_id: auth.companyId,
                    category_id: feeCategory?.id || null,
                    description: `Taxa cartao OS-${String(os.os_number).padStart(4, '0')} — ${body.payment!.method} ${installmentCount > 1 ? installmentCount + 'x' : ''}`.trim(),
                    total_amount: cardFeeTotal,
                    paid_amount: 0,
                    due_date: new Date(),
                    status: 'PENDENTE',
                    payment_method: 'Desconto automatico',
                  },
                })
              }
            }
          } catch (err) {
            console.warn('[driver/entrega] AR create falhou:', err)
          }

          void sendReceiptEmail(auth.companyId, os.id, amount, body.payment!.method, body.signer_name!).catch(() => {})
        }
      }
    } catch (err) {
      console.warn('[driver/entrega] transition falhou:', err instanceof Error ? err.message : String(err))
    }
  }

  return NextResponse.json({ data: { id: params.id, ok: true } })
}

function validate(body: Partial<Body>): string[] {
  const errs: string[] = []
  if (!body.event_id) errs.push('event_id obrigatorio')
  if (!body.status) errs.push('status obrigatorio')
  if (body.status && !['entregue_aprovado', 'recusado_sem_conserto'].includes(body.status))
    errs.push('status invalido')
  if (!body.signature_png_base64) errs.push('assinatura obrigatoria')
  if (!body.signer_name?.trim()) errs.push('signer_name obrigatorio')
  if (body.status === 'entregue_aprovado') {
    if (!body.payment) errs.push('payment obrigatorio quando entregue')
    else {
      if (!['pix', 'dinheiro', 'cartao_credito', 'cartao_debito', 'boleto'].includes(body.payment.method))
        errs.push('payment.method invalido')
      if (!Number.isFinite(body.payment.amount_cents) || body.payment.amount_cents < 0)
        errs.push('payment.amount_cents invalido')
    }
  }
  return errs
}
