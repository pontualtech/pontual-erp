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

    const quote = await prisma.quote.findFirst({
      where: { id: params.id, company_id: user.companyId },
      include: {
        service_orders: {
          include: { customers: true },
        },
        quote_items: true,
      },
    })
    if (!quote) return error('Orçamento não encontrado', 404)
    if (quote.status !== 'DRAFT' && quote.status !== 'SENT') {
      return error('Orçamento não pode ser enviado neste status', 422)
    }

    const { channel } = await req.json() // 'whatsapp' | 'email'

    // Build approval URL
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://erp.pontualtechsolucoes.com.br'
    const approvalUrl = `${baseUrl}/api/quotes/approve/${quote.approval_token}`

    // Send via n8n webhook
    const webhookUrl = process.env.N8N_QUOTE_WEBHOOK_URL
    if (!webhookUrl) return error('Webhook URL não configurada', 500)

    const webhookPayload = {
      quoteId: quote.id,
      quoteNumber: quote.quote_number,
      channel: channel || 'whatsapp',
      approvalUrl,
      customer: {
        name: quote.service_orders.customers.legal_name,
        phone: quote.service_orders.customers.mobile || quote.service_orders.customers.phone,
        email: quote.service_orders.customers.email,
      },
      os: {
        osNumber: quote.service_orders.os_number,
        equipment: quote.service_orders.equipment_type,
      },
      totalAmount: quote.total_amount,
      validUntil: quote.valid_until,
      items: quote.quote_items,
    }

    const webhookRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhookPayload),
    })

    if (!webhookRes.ok) {
      return error(`Falha ao enviar via webhook: ${webhookRes.status}`, 502)
    }

    // Update quote status
    const updated = await prisma.quote.update({
      where: { id: params.id, company_id: user.companyId },
      data: {
        status: 'SENT',
        sent_at: new Date(),
      },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'os',
      action: 'send_quote',
      entityId: quote.service_order_id,
      newValue: { quoteId: quote.id, channel },
    })

    return success(updated)
  } catch (err) {
    return handleError(err)
  }
}
