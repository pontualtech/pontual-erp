import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { sendEmail } from '@/lib/send-email'

type Params = { params: { id: string } }

/**
 * POST /api/os/[id]/notificar-pronto
 * Notifica o cliente que o equipamento está pronto para retirada/entrega
 * Body: { channels: ('email' | 'whatsapp')[] }
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const os = await prisma.serviceOrder.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      include: { customers: true, companies: true },
    })
    if (!os) return error('OS não encontrada', 404)

    const body = await req.json().catch(() => ({}))
    const channels: string[] = body.channels || ['email']

    // Carregar settings
    const settings = await prisma.setting.findMany({ where: { company_id: user.companyId } })
    const cfg: Record<string, string> = {}
    for (const s of settings) cfg[s.key] = s.value

    const customerName = os.customers?.legal_name || 'Cliente'
    const customerFirstName = customerName.split(' ')[0]
    const customerEmail = os.customers?.email || ''
    const customerPhone = os.customers?.mobile || os.customers?.phone || ''
    const osNum = String(os.os_number)
    const equipment = [os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' ')
    const companyName = os.companies?.name || cfg['company.name'] || 'Empresa'
    const companyPhone = cfg['company.phone'] || '(11) 2626-3841'
    const whatsappNum = (cfg['company.whatsapp'] || '551126263841').replace(/\D/g, '')
    const whatsappUrl = `https://wa.me/${whatsappNum}`
    const portalUrl = cfg['portal.url'] || 'https://pontualtech.com.br/#consulta-os'

    // ===== WHATSAPP =====
    const whatsappMsg = `Ola ${customerFirstName}! Tudo bem?

Temos uma otima noticia! Seu equipamento ${equipment} (OS #${osNum}) esta pronto!

Voce pode retirar no nosso endereco ou, se preferir, agendamos a entrega.

Horario de funcionamento: Seg a Sex, 09:00 as 17:00

Acompanhe pelo portal: ${portalUrl}

Precisando de algo:
${companyPhone}
${whatsappUrl}

Obrigado pela confianca!
${companyName}`

    // ===== EMAIL =====
    const emailHtml = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333;">
  <div style="background:linear-gradient(135deg,#2563eb,#1d4ed8);padding:28px;border-radius:12px 12px 0 0;text-align:center;">
    <p style="margin:0;font-size:40px;">🎉</p>
    <h1 style="color:#fff;margin:8px 0 0;font-size:22px;">Equipamento Pronto!</h1>
  </div>
  <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:28px;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;margin:0 0 16px;">Ola <strong>${customerFirstName}</strong>,</p>
    <p style="font-size:14px;color:#555;margin:0 0 20px;line-height:1.6;">
      Temos uma otima noticia! O reparo do seu equipamento foi concluido com sucesso!
    </p>

    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:0 0 20px;">
      <table style="width:100%;font-size:14px;color:#166534;">
        <tr><td style="padding:4px 0;font-weight:600;">Equipamento:</td><td style="padding:4px 0;">${equipment}</td></tr>
        <tr><td style="padding:4px 0;font-weight:600;">OS:</td><td style="padding:4px 0;">#${osNum}</td></tr>
        <tr><td style="padding:4px 0;font-weight:600;">Status:</td><td style="padding:4px 0;font-weight:700;color:#16a34a;">Pronto para retirada</td></tr>
      </table>
    </div>

    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:14px;margin:0 0 20px;">
      <p style="margin:0 0 6px;font-size:13px;color:#1e40af;font-weight:600;">COMO RETIRAR</p>
      <p style="margin:0;font-size:14px;color:#1e40af;line-height:1.5;">
        Voce pode retirar no nosso endereco ou, se preferir, agendamos a entrega.<br/>
        <strong>Horario:</strong> Seg a Sex, 09:00 as 17:00
      </p>
    </div>

    <div style="text-align:center;margin:0 0 16px;">
      <a href="${portalUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:14px;">
        Acompanhar minha OS
      </a>
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

    const results: { channel: string; status: string }[] = []

    if (channels.includes('email') && customerEmail) {
      const sent = await sendEmail(customerEmail, `Equipamento Pronto — OS #${osNum} — ${companyName}`, emailHtml)
      results.push({ channel: 'email', status: sent ? 'enviado' : 'erro' })
    } else if (channels.includes('email') && !customerEmail) {
      results.push({ channel: 'email', status: 'sem_email' })
    }

    if (channels.includes('whatsapp') && customerPhone) {
      try {
        const phone = customerPhone.replace(/\D/g, '')
        await fetch(`${process.env.NEXT_PUBLIC_APP_URL || ''}/api/integracoes/chatwoot/enviar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, message: whatsappMsg }),
        })
        results.push({ channel: 'whatsapp', status: 'enviado' })
      } catch {
        results.push({ channel: 'whatsapp', status: 'erro' })
      }
    } else if (channels.includes('whatsapp') && !customerPhone) {
      results.push({ channel: 'whatsapp', status: 'sem_telefone' })
    }

    // Registrar nas obs internas
    const now = new Date()
    const dataHora = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    const canaisEnviados = results.filter(r => r.status === 'enviado').map(r => r.channel).join(', ') || 'nenhum'
    const nota = `[${dataHora}] Notificacao "Equipamento Pronto" enviada via ${canaisEnviados}`
    await prisma.serviceOrder.update({
      where: { id: os.id },
      data: { internal_notes: os.internal_notes ? `${os.internal_notes}\n${nota}` : nota },
    })

    return success({ results })
  } catch (err) {
    return handleError(err)
  }
}
