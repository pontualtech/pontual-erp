import { NextRequest } from 'next/server'
import { prisma } from '@pontual/db'
import { success, error, handleError } from '@/lib/api-response'
import { propagateQuoteApprovalToOS } from '@/lib/quote-os-sync'

// PUBLIC ROUTE — no auth required, token-based access

type Params = { params: { token: string } }

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const quote = await prisma.quote.findFirst({
      where: { approval_token: params.token },
      include: {
        service_orders: {
          select: {
            os_number: true,
            equipment_type: true,
            equipment_brand: true,
            equipment_model: true,
            reported_issue: true,
          },
        },
        quote_items: {
          select: {
            description: true,
            quantity: true,
            unit_price: true,
            total_price: true,
          },
        },
      },
    })

    if (!quote) return error('Orçamento não encontrado ou link inválido', 404)
    if (quote.status === 'APPROVED') return error('Orçamento já foi aprovado', 410)
    if (quote.status === 'REJECTED') return error('Orçamento já foi recusado', 410)

    // Check expiration
    if (quote.valid_until && new Date() > quote.valid_until) {
      await prisma.quote.update({
        where: { id: quote.id },
        data: { status: 'EXPIRED' },
      })
      return error('Orçamento expirado', 410)
    }

    return success({
      quoteNumber: quote.quote_number,
      status: quote.status,
      totalAmount: quote.total_amount,
      validUntil: quote.valid_until,
      notes: quote.notes,
      serviceOrder: quote.service_orders,
      items: quote.quote_items,
    })
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const quote = await prisma.quote.findFirst({
      where: { approval_token: params.token },
    })

    if (!quote) return error('Orçamento não encontrado ou link inválido', 404)
    if (quote.status === 'APPROVED') return error('Orçamento já foi aprovado', 410)
    if (quote.status === 'REJECTED') return error('Orçamento já foi recusado', 410)

    // Check expiration
    if (quote.valid_until && new Date() > quote.valid_until) {
      await prisma.quote.update({
        where: { id: quote.id },
        data: { status: 'EXPIRED' },
      })
      return error('Orçamento expirado', 410)
    }

    const { action } = await req.json()

    // Eco audit H11 (2026-05-29): captura IP+UA pra audit trail
    // (aprovação financeira via token público — evidência se disputa).
    const reqIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('x-real-ip')
      || 'unknown'
    const reqUa = (req.headers.get('user-agent') || 'unknown').slice(0, 250)

    if (action === 'approve') {
      // Atomico: aprova quote + propaga total_amount pra os.total_cost.
      // Sem essa propagacao, conciliacao da maquininha (match-engine) nao
      // acha a OS quando o cliente paga, pois compara por os.total_cost.
      await prisma.$transaction(async (tx) => {
        await tx.quote.update({
          where: { id: quote.id },
          data: {
            status: 'APPROVED',
            approved_at: new Date(),
          },
        })
        await propagateQuoteApprovalToOS(tx, quote.id)
        // Eco audit H11: audit log estruturado da aprovação via token público.
        // Trail forense se cliente disputar ("nunca aprovei").
        await tx.auditLog.create({
          data: {
            company_id: quote.company_id,
            user_id: 'public:quote-token',
            module: 'quotes',
            action: 'quote.approved.via_token',
            entity_id: quote.id,
            ip_address: reqIp,
            new_value: {
              quote_number: quote.quote_number,
              service_order_id: quote.service_order_id,
              token_prefix: params.token.slice(0, 8),
              user_agent: reqUa,
            },
          },
        }).catch(err => {
          // Log mas não bloqueia aprovação (já commitada antes)
          console.error(`[quotes/approve] audit log FAILED quote #${quote.quote_number}:`, err instanceof Error ? err.message : err)
        })
      })

      // Notify via n8n webhook (fire-and-forget — Eco audit H11: logar erro)
      const webhookUrl = process.env.N8N_QUOTE_APPROVED_WEBHOOK_URL
      if (webhookUrl) {
        fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            quoteId: quote.id,
            quoteNumber: quote.quote_number,
            serviceOrderId: quote.service_order_id,
            action: 'approved',
          }),
        }).catch(err => {
          console.error(`[quotes/approve] n8n webhook FAILED quote #${quote.quote_number}:`, err instanceof Error ? err.message : err)
        })
      }

      return success({ status: 'APPROVED', quoteNumber: quote.quote_number })
    }

    if (action === 'reject') {
      await prisma.quote.update({
        where: { id: quote.id },
        data: {
          status: 'REJECTED',
          rejected_at: new Date(),
        },
      })

      const webhookUrl = process.env.N8N_QUOTE_APPROVED_WEBHOOK_URL
      if (webhookUrl) {
        fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            quoteId: quote.id,
            quoteNumber: quote.quote_number,
            serviceOrderId: quote.service_order_id,
            action: 'rejected',
          }),
        }).catch(() => {})
      }

      return success({ status: 'REJECTED', quoteNumber: quote.quote_number })
    }

    return error('action deve ser "approve" ou "reject"', 400)
  } catch (err) {
    return handleError(err)
  }
}
