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
  const byEvent = await prisma.logisticsStop.findFirst({
    where: { event_id: body.event_id!, company_id: auth.companyId },
    select: { id: true, completed_at: true },
  })
  if (byEvent && byEvent.id !== params.id) {
    return NextResponse.json({ error: 'event_id em conflito com outra parada' }, { status: 409 })
  }
  if (byEvent?.completed_at) {
    return NextResponse.json({ data: { id: byEvent.id, already_completed: true } })
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

  await prisma.logisticsStop.update({
    where: { id: params.id },
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

  // Incrementa completed_stops da rota
  await prisma.logisticsRoute.updateMany({
    where: { id: stop.route_id },
    data: { completed_stops: { increment: 1 } },
  })

  // Transition OS + (se aprovado) criar Payment
  if (stop.os_id && targetStatus) {
    try {
      const os = await prisma.serviceOrder.findFirst({
        where: { id: stop.os_id, company_id: auth.companyId },
        select: { id: true, os_number: true, customer_id: true, total_cost: true },
      })
      if (os) {
        await prisma.serviceOrder.update({
          where: { id: os.id },
          data: {
            status_id: targetStatus.id,
            ...(isApproved ? { actual_delivery: new Date() } : {}),
          },
        })
        await prisma.serviceOrderHistory.create({
          data: {
            company_id: auth.companyId,
            service_order_id: os.id,
            to_status_id: targetStatus.id,
            changed_by: auth.id,
            notes: isApproved
              ? `Entrega finalizada por ${auth.name} — pagamento: ${body.payment!.method}`
              : `Recusada pelo cliente — ${body.refusal_reason!.trim()}`,
          },
        })

        // Cria Payment + AccountReceivable (PAGO) se aprovado e houver valor
        if (isApproved && body.payment!.amount_cents > 0) {
          const amount = body.payment!.amount_cents
          const paymentMethodMapped = PAYMENT_METHOD_MAP[body.payment!.method]
          const installmentCount = Math.max(1, Number(body.payment!.installments || 1))

          try {
            await prisma.payment.create({
              data: {
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
            })
          } catch (err) {
            console.warn('[driver/entrega] Payment create falhou:', err)
          }

          // Lanca conta a receber ja quitada — essa AR e o elo entre OS
          // e financeiro. Status PAGO pq cliente pagou na hora.
          try {
            await prisma.accountReceivable.create({
              data: {
                company_id: auth.companyId,
                customer_id: os.customer_id,
                service_order_id: os.id,
                description: `Entrega OS #${os.os_number} — ${body.payment!.method}`,
                total_amount: amount,
                received_amount: amount,
                due_date: new Date(),
                status: 'PAGO',
                payment_method: paymentMethodMapped,
                installment_count: installmentCount,
              },
            })
          } catch (err) {
            console.warn('[driver/entrega] AR create falhou:', err)
          }

          // Email de recibo (fire-and-forget)
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
