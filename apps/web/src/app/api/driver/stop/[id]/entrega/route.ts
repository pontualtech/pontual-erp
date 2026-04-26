import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireDriver } from '@/lib/driver-auth'
import { findStatusByName } from '@/lib/module-status'
import { sendCompanyEmail } from '@/lib/send-email'
import { getReciboEmail } from '@/lib/email-templates/recibo'
import { buildMagicLink } from '@/lib/portal-magic-url'

function fmtBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

const METHOD_LABEL: Record<string, string> = {
  pix: 'PIX',
  dinheiro: 'Dinheiro',
  cartao_credito: 'Cartao de credito',
  cartao_debito: 'Cartao de debito',
  boleto: 'Boleto',
}

function portalUrl(companyId: string): string {
  if (companyId === 'pontualtech-001') return 'https://portal.pontualtech.com.br/portal/pontualtech'
  if (companyId === '86c829cf-32ed-4e40-80cd-59ce4178aa1a') return 'https://portal.imprimitech.com.br/portal/imprimitech'
  return 'https://portal.pontualtech.com.br/portal/pontualtech'
}

function supportWa(companyId: string): string {
  if (companyId === 'pontualtech-001') return 'https://wa.me/551126263841'
  if (companyId === '86c829cf-32ed-4e40-80cd-59ce4178aa1a') return 'https://wa.me/551150439869'
  return 'https://wa.me/551126263841'
}

/**
 * Envia recibo do pagamento por e-mail pro cliente — template editavel
 * em /config/email-templates, com garantia 3m, equipamento + serial,
 * link portal + suporte. Fire-and-forget.
 */
async function sendReceiptEmail(
  companyId: string,
  osId: string,
  amountCents: number,
  method: string,
  signerName: string,
  installments: number,
): Promise<void> {
  const os = await prisma.serviceOrder.findFirst({
    where: { id: osId, company_id: companyId },
    select: {
      id: true,
      customer_id: true,
      os_number: true,
      equipment_type: true,
      equipment_brand: true,
      equipment_model: true,
      serial_number: true,
      customers: { select: { id: true, legal_name: true, email: true } },
    },
  })
  const email = os?.customers?.email
  if (!os || !email) return
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true, slug: true } })

  // Magic-link auto-login pra essa OS
  const magicLink = os.customers?.id ? buildMagicLink({
    customerId: os.customers.id,
    companyId,
    slug: company?.slug || 'pontualtech',
    osId: os.id,
  }).url : portalUrl(companyId)

  const equipmentCompleto = [os.equipment_type, os.equipment_brand, os.equipment_model]
    .filter(Boolean).join(' ') || 'Equipamento'
  const formaPagamento = METHOD_LABEL[method] || method
  const formaCompleta = installments > 1 ? `${formaPagamento} (${installments}x)` : formaPagamento
  const garantiaAte = new Date()
  garantiaAte.setMonth(garantiaAte.getMonth() + 3)

  try {
    const tpl = await getReciboEmail(companyId, {
      cliente: os.customers?.legal_name || 'Cliente',
      empresa: company?.name || 'PontualTech',
      os_number: os.os_number,
      valor: fmtBRL(amountCents),
      forma_pagamento: formaCompleta,
      recebido_por: signerName,
      data_hora: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
      equipamento_completo: equipmentCompleto,
      serial_number: os.serial_number || 's/n',
      garantia_ate: garantiaAte.toLocaleDateString('pt-BR'),
      link_portal: magicLink,
      link_suporte: supportWa(companyId),
    })
    await sendCompanyEmail(companyId, email, tpl.subject, tpl.html)
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
    due_days?: number | null      // dias ate vencimento (so boleto, default 7)
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

        // Classifica metodo: card | boleto | onsite (pix/dinheiro — recebido no ato)
        const pmLowerForClassify = (body.payment?.method || '').toLowerCase()
        const isCardPayment = pmLowerForClassify.includes('cart')
        const isBoletoPayment = pmLowerForClassify.includes('boleto')
        const isReceivedOnSite = !isCardPayment && !isBoletoPayment

        if (shouldCreateFinancial) {
          // Payment tem idempotency_key unique — retry seguro
          // CONFIRMED + paid_at=now so pra PIX/dinheiro (dinheiro na mao do
          // motorista, PIX caiu na conta). Cartao e boleto = PENDING —
          // dinheiro ainda nao caiu, AR fica pendente ate liquidar.
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
              status: isReceivedOnSite ? 'CONFIRMED' : 'PENDING',
              method: paymentMethodMapped,
              billing_type: paymentMethodMapped,
              paid_at: isReceivedOnSite ? new Date() : null,
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
          // AR status:
          //   pix/dinheiro       = PAGO (recebido no ato)
          //   cartao (cred/deb)  = PENDENTE (operadora paga D+N)
          //   boleto             = PENDENTE (cliente paga no banco ate o vencimento)
          // Igual ao que o atendente faz em /api/os/[id]/transition.
          const pmLower = (body.payment!.method || '').toLowerCase()
          const isCard = pmLower.includes('cart')
          const isBoleto = pmLower.includes('boleto')
          const isOnSite = !isCard && !isBoleto
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

              // Data de vencimento:
              //   PIX/dinheiro → hoje (vencimento = data recebida)
              //   cartao       → hoje + D dias uteis (D+N da operadora)
              //   boleto       → hoje + due_days (default 7, configuravel por entrega)
              const dueDate = new Date()
              if (isBoleto) {
                const dueDays = Math.max(1, Math.min(60,
                  Number.isFinite(body.payment?.due_days) ? Number(body.payment!.due_days) : 7,
                ))
                dueDate.setDate(dueDate.getDate() + dueDays)
              } else if (daysToReceive > 0) {
                let dias = 0
                while (dias < daysToReceive) {
                  dueDate.setDate(dueDate.getDate() + 1)
                  const dow = dueDate.getDay()
                  if (dow !== 0 && dow !== 6) dias++
                }
              }

              // Lookup categoria "Venda de Servicos" da empresa — usa como
              // categoria padrao de receita pra ARs criados via motorista.
              // Normaliza (case-insensitive, sem acento) pra tolerar variacoes
              // como "Venda de Serviços" vs "Venda de Servicos".
              let serviceRevenueCategoryId: string | null = null
              try {
                const cat = await prisma.category.findFirst({
                  where: {
                    company_id: auth.companyId,
                    module: 'financeiro_receita',
                    name: { mode: 'insensitive', contains: 'Venda de Servi' },
                  },
                  select: { id: true },
                })
                serviceRevenueCategoryId = cat?.id || null
              } catch { /* silent — AR fica sem categoria */ }

              // Comprovante capturado pelo motorista (PIX screenshot, foto maquininha)
              const receiptUrl = body.payment?.receipt_photo_base64
                ? `data:image/jpeg;base64,${body.payment.receipt_photo_base64}`
                : null

              const ar = await prisma.accountReceivable.create({
                data: {
                  company_id: auth.companyId,
                  customer_id: os.customer_id,
                  service_order_id: os.id,
                  category_id: serviceRevenueCategoryId,
                  description: arDescription,
                  total_amount: amount,
                  received_amount: isOnSite ? amount : 0,
                  due_date: dueDate,
                  status: isOnSite ? 'PAGO' : 'PENDENTE',
                  payment_method: paymentMethodMapped,
                  receipt_url: receiptUrl,
                  installment_count: installmentCount,
                  card_fee_total: cardFeeTotal,
                  net_amount: netAmount,
                  notes: isBoleto
                    ? `Boleto a ser enviado ao cliente. Vencimento em ${Math.round((dueDate.getTime() - Date.now()) / 86400000)} dias. Motorista: ${auth.name}`
                    : isCard
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

          void sendReceiptEmail(auth.companyId, os.id, amount, body.payment!.method, body.signer_name!, installmentCount).catch(() => {})
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
