import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { sendEmail } from '@/lib/send-email'
import { createHmac } from 'crypto'

type Params = { params: { id: string } }

function validateOrcamentoToken(osId: string, token: string): boolean {
  const key = process.env.ENCRYPTION_KEY
  if (!key) return false
  const expected = createHmac('sha256', key).update('orcamento:' + osId).digest('hex').slice(0, 16)
  return token === expected
}

function fmtCents(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

/**
 * GET - Dados da OS para a página de aprovação de orçamento
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')
    const slug = searchParams.get('slug')

    if (!token || !slug) {
      return error('Token e slug são obrigatórios', 400)
    }

    if (!validateOrcamentoToken(params.id, token)) {
      return error('Token inválido ou expirado', 401)
    }

    const os = await prisma.serviceOrder.findFirst({
      where: { id: params.id, deleted_at: null },
      include: {
        customers: true,
        companies: true,
        module_statuses: true,
        service_order_items: { where: { deleted_at: null } },
      },
    })

    if (!os) return error('Ordem de serviço não encontrada', 404)

    if (os.companies.slug !== slug) {
      return error('Token inválido', 401)
    }

    // Load company settings
    const settings = await prisma.setting.findMany({
      where: { company_id: os.company_id },
    })
    const settingsMap: Record<string, string> = {}
    for (const s of settings) settingsMap[s.key] = s.value

    const items = os.service_order_items.map(item => ({
      id: item.id,
      description: item.description,
      item_type: item.item_type,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: item.total_price,
    }))

    return success({
      id: os.id,
      os_number: os.os_number,
      equipment_type: os.equipment_type,
      equipment_brand: os.equipment_brand,
      equipment_model: os.equipment_model,
      serial_number: os.serial_number,
      reported_issue: os.reported_issue,
      diagnosis: os.diagnosis,
      total_cost: os.total_cost || 0,
      total_parts: os.total_parts || 0,
      total_services: os.total_services || 0,
      status: os.module_statuses?.name || '—',
      items,
      customer_name: os.customers?.legal_name || '—',
      company: {
        name: os.companies.name,
        phone: settingsMap['company.phone'] || settingsMap['telefone'] || null,
        email: settingsMap['company.email'] || settingsMap['email'] || null,
        whatsapp: settingsMap['company.whatsapp'] || settingsMap['whatsapp'] || null,
      },
    })
  } catch (err) {
    return handleError(err)
  }
}

/**
 * POST - Aprovar ou recusar orçamento
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const body = await request.json()
    const { token, slug, action, reason } = body as {
      token?: string
      slug?: string
      action?: 'approve' | 'reject'
      reason?: string
    }

    if (!token || !slug) {
      return error('Token e slug são obrigatórios', 400)
    }

    if (!validateOrcamentoToken(params.id, token)) {
      return error('Token inválido ou expirado', 401)
    }

    if (!action || !['approve', 'reject'].includes(action)) {
      return error('Ação inválida. Use "approve" ou "reject"', 400)
    }

    const os = await prisma.serviceOrder.findFirst({
      where: { id: params.id, deleted_at: null },
      include: {
        companies: true,
        customers: true,
        module_statuses: true,
      },
    })

    if (!os) return error('Ordem de serviço não encontrada', 404)
    if (os.companies.slug !== slug) return error('Token inválido', 401)

    if (action === 'approve') {
      // Bloquear dupla aprovação
      const currentStatusName = os.module_statuses?.name?.toLowerCase() || ''
      if (currentStatusName.includes('aprovad') || currentStatusName.includes('execu') || currentStatusName.includes('pronta') || currentStatusName.includes('reparad') || os.module_statuses?.is_final) {
        return error('Este orçamento já foi aprovado anteriormente.', 410)
      }

      // Find "Aprovado" status
      const approvedStatus = await prisma.moduleStatus.findFirst({
        where: {
          company_id: os.company_id,
          module: 'os',
          name: { contains: 'Aprovad', mode: 'insensitive' },
        },
      })

      if (!approvedStatus) {
        return error('Status "Aprovado" não configurado. Entre em contato com a empresa.', 400)
      }

      // Calcular previsão: 10 dias úteis a partir de hoje
      const estimatedDelivery = new Date()
      let diasUteis = 0
      while (diasUteis < 10) {
        estimatedDelivery.setDate(estimatedDelivery.getDate() + 1)
        const dow = estimatedDelivery.getDay()
        if (dow !== 0 && dow !== 6) diasUteis++
      }

      // Transição atômica
      await prisma.$transaction(async (tx) => {
        await tx.serviceOrder.update({
          where: { id: os.id },
          data: {
            status_id: approvedStatus.id,
            approved_cost: os.total_cost || 0,
            estimated_delivery: estimatedDelivery,
            updated_at: new Date(),
          },
        })

        await tx.serviceOrderHistory.create({
          data: {
            company_id: os.company_id,
            service_order_id: os.id,
            from_status_id: os.status_id,
            to_status_id: approvedStatus.id,
            changed_by: 'portal',
            notes: 'Orçamento aprovado pelo cliente via portal',
          },
        })
      })

      const osNum = String(os.os_number).padStart(4, '0')
      const customerName = os.customers?.legal_name || 'Cliente'
      const customerFirstName = customerName.split(' ')[0]
      const fmtValue = fmtCents(os.total_cost || 0)
      const previsaoStr = estimatedDelivery.toLocaleDateString('pt-BR')

      // Carregar settings para WhatsApp e template
      const settings = await prisma.setting.findMany({ where: { company_id: os.company_id } })
      const cfg: Record<string, string> = {}
      for (const s of settings) cfg[s.key] = s.value
      const whatsappUrl = `https://wa.me/${(cfg['company.whatsapp'] || '551126263841').replace(/\D/g, '')}`
      const companyPhone = cfg['company.phone'] || '(11) 2626-3841'
      const companyName = os.companies.name || 'Empresa'
      const equipment = [os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' ')

      logAudit({
        companyId: os.company_id,
        userId: 'portal',
        module: 'os',
        action: 'quote_approved_by_customer',
        entityId: os.id,
        newValue: { customer_name: customerName, os_number: os.os_number, total_cost: os.total_cost, estimated_delivery: previsaoStr },
      })

      // 1. Aviso interno URGENTE para técnicos
      await prisma.announcement.create({
        data: {
          company_id: os.company_id,
          title: `✅ OS ${osNum} APROVADA — ${customerName}`,
          message: `O cliente ${customerName} aprovou o orçamento da OS ${osNum} (${equipment}) no valor de ${fmtValue}.\n\nPrevisão de entrega: ${previsaoStr} (10 dias úteis).\n\nIniciar o reparo imediatamente!`,
          priority: 'URGENTE',
          require_read: true,
          author_name: 'Sistema',
          created_by: 'portal',
        },
      })

      // 2. Email de confirmação ao cliente
      const customerEmail = os.customers?.email
      if (customerEmail) {
        const emailHtml = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333;">
  <div style="background:linear-gradient(135deg,#22c55e,#16a34a);padding:28px;border-radius:12px 12px 0 0;text-align:center;">
    <p style="margin:0;font-size:40px;">✅</p>
    <h1 style="color:#fff;margin:8px 0 0;font-size:22px;">Orcamento Aprovado!</h1>
  </div>
  <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:28px;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;margin:0 0 16px;">Ola <strong>${customerFirstName}</strong>,</p>
    <p style="font-size:14px;color:#555;margin:0 0 20px;line-height:1.6;">
      Seu orcamento para a OS <strong>#${osNum}</strong> foi aprovado com sucesso!
      Nossa equipe tecnica ja esta ciente e o reparo comeca a partir de agora.
    </p>

    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:0 0 20px;">
      <table style="width:100%;font-size:14px;color:#166534;">
        <tr><td style="padding:4px 0;font-weight:600;">Equipamento:</td><td style="padding:4px 0;">${equipment}</td></tr>
        <tr><td style="padding:4px 0;font-weight:600;">Valor aprovado:</td><td style="padding:4px 0;font-weight:700;font-size:18px;">${fmtValue}</td></tr>
        <tr><td style="padding:4px 0;font-weight:600;">Previsao de entrega:</td><td style="padding:4px 0;font-weight:700;">${previsaoStr}</td></tr>
        <tr><td style="padding:4px 0;font-weight:600;">Prazo:</td><td style="padding:4px 0;">10 dias uteis a partir de hoje</td></tr>
      </table>
    </div>

    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:14px;margin:0 0 20px;">
      <p style="margin:0;font-size:13px;color:#1e40af;line-height:1.5;">
        <strong>Proximo passo:</strong> Nossa equipe vai iniciar o reparo e voce sera notificado quando o equipamento estiver pronto para retirada/entrega.
      </p>
    </div>

    <div style="text-align:center;margin:0 0 20px;">
      <a href="${whatsappUrl}" style="display:inline-block;background:#25d366;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:14px;">
        Falar com o Suporte via WhatsApp
      </a>
    </div>

    <div style="border-top:1px solid #e5e7eb;padding-top:16px;">
      <p style="font-size:13px;color:#555;margin:0 0 4px;">${companyName}</p>
      <p style="font-size:12px;color:#999;margin:0;">Tel: ${companyPhone} | <a href="${whatsappUrl}" style="color:#16a34a;">WhatsApp</a></p>
    </div>
  </div>
</div>`
        sendEmail(customerEmail, `Orcamento Aprovado — OS #${osNum} — ${companyName}`, emailHtml).catch(() => {})
      }

      // 3. WhatsApp/Chatwoot para equipe (fire-and-forget)
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
      if (appUrl) {
        fetch(`${appUrl}/api/integracoes/chatwoot/enviar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: cfg['company.whatsapp'] || '551126263841',
            message: `✅ OS ${osNum} APROVADA!\nCliente: ${customerName}\nEquipamento: ${equipment}\nValor: ${fmtValue}\nPrevisao: ${previsaoStr}\n\nIniciar reparo!`,
          }),
        }).catch(() => {})
      }

      return success({ action: 'approved', message: 'Orçamento aprovado com sucesso!' })
    }

    if (action === 'reject') {
      // Find "Cancelada" or similar status
      const cancelledStatus = await prisma.moduleStatus.findFirst({
        where: {
          company_id: os.company_id,
          module: 'os',
          OR: [
            { name: { contains: 'Cancelad', mode: 'insensitive' } },
            { name: { contains: 'Recusad', mode: 'insensitive' } },
          ],
        },
      })

      // Add rejection notes regardless
      const today = new Date().toLocaleDateString('pt-BR')
      const currentNotes = os.internal_notes || ''
      const rejectionNote = `Orçamento recusado pelo cliente em ${today} (via portal)${reason ? ': ' + reason : ''}`

      const updateData: any = {
        internal_notes: currentNotes ? `${currentNotes}\n${rejectionNote}` : rejectionNote,
        updated_at: new Date(),
      }

      if (cancelledStatus) {
        updateData.status_id = cancelledStatus.id
      }

      await prisma.serviceOrder.update({
        where: { id: os.id },
        data: updateData,
      })

      // Create history entry if status changed
      if (cancelledStatus) {
        await prisma.serviceOrderHistory.create({
          data: {
            company_id: os.company_id,
            service_order_id: os.id,
            from_status_id: os.status_id,
            to_status_id: cancelledStatus.id,
            changed_by: 'portal',
            notes: rejectionNote,
          },
        })
      }

      logAudit({
        companyId: os.company_id,
        userId: 'portal',
        module: 'os',
        action: 'quote_rejected_by_customer',
        entityId: os.id,
        newValue: {
          customer_name: os.customers?.legal_name,
          os_number: os.os_number,
          total_cost: os.total_cost,
          reason: reason || null,
          rejected_via: 'portal',
        },
      })

      // Notificar equipe via aviso interno
      const osNum2 = String(os.os_number).padStart(4, '0')
      const customerName2 = os.customers?.legal_name || 'Cliente'
      await prisma.announcement.create({
        data: {
          company_id: os.company_id,
          title: `❌ Orçamento OS-${osNum2} RECUSADO`,
          message: `O cliente ${customerName2} recusou o orçamento da OS-${osNum2} pelo portal.${reason ? ` Motivo: "${reason}"` : ''} Entrar em contato para negociar.`,
          priority: 'URGENTE',
          require_read: true,
          author_name: 'Sistema',
          created_by: 'portal',
        },
      })

      return success({ action: 'rejected', message: 'Orçamento recusado. A empresa foi notificada.' })
    }

    return error('Ação inválida', 400)
  } catch (err) {
    return handleError(err)
  }
}
