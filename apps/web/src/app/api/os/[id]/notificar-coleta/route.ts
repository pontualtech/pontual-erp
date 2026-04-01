import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { sendEmail } from '@/lib/send-email'

type Params = { params: { id: string } }

/**
 * POST /api/os/[id]/notificar-coleta
 * Envia notificação de coleta por email e/ou WhatsApp
 *
 * Body: { channels: ('email' | 'whatsapp')[] }
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const os = await prisma.serviceOrder.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      include: { customers: true },
    })
    if (!os) return error('OS não encontrada', 404)

    const body = await req.json().catch(() => ({}))
    const channels: string[] = body.channels || ['email']

    const customerName = os.customers?.legal_name?.split(' ')[0] || 'Cliente'
    const customerFullName = os.customers?.legal_name || 'Cliente'
    const customerEmail = os.customers?.email || ''
    const customerPhone = os.customers?.mobile || os.customers?.phone || ''
    const osNum = String(os.os_number).padStart(4, '0')
    const equipDesc = [os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' ')
    const portalUrl = 'https://pontualtech.com.br/#consulta-os'

    // Buscar outras OS do mesmo cliente com status "Coletar"
    const coletarStatus = await prisma.moduleStatus.findFirst({
      where: { company_id: user.companyId, module: 'os', name: { contains: 'oletar' } },
    })
    let otherOS: { os_number: number; equipment_type: string; equipment_brand: string | null; equipment_model: string | null }[] = []
    if (coletarStatus) {
      otherOS = await prisma.serviceOrder.findMany({
        where: {
          company_id: user.companyId,
          customer_id: os.customer_id,
          status_id: coletarStatus.id,
          deleted_at: null,
          id: { not: os.id },
        },
        select: { os_number: true, equipment_type: true, equipment_brand: true, equipment_model: true },
        orderBy: { os_number: 'asc' },
      })
    }

    // Montar lista de equipamentos (OS atual + outras do mesmo cliente em coleta)
    const allEquipments = [
      { num: os.os_number, desc: equipDesc },
      ...otherOS.map(o => ({
        num: o.os_number,
        desc: [o.equipment_type, o.equipment_brand, o.equipment_model].filter(Boolean).join(' '),
      })),
    ]

    const equipList = allEquipments
      .map((e, i) => `${i + 1}. ${e.desc} (OS #${e.num})`)
      .join('\n')

    const osNumbers = allEquipments.map(e => `#${e.num}`).join(' e ')

    // ===== MENSAGEM WHATSAPP (texto plano) =====
    const whatsappMsg = `Tudo certo, ${customerName}!
OS ${osNumbers} aberta com sucesso!
Seu agendamento ja esta com nossa logistica.

Equipamentos para coleta:
${equipList}

Fique atento as instrucoes:
A coleta ocorrera durante o horario comercial (09:00 as 17:00).
Como seguimos uma rota, nao ha horario fixo, entao deixe alguem avisado!

Mantenha com voce:
- Cabos de energia e fontes

Pode enviar:
- O equipamento com os toners/cartuchos dentro

Orcamentos:
Fique de olho no seu e-mail, pois o laudo sera enviado por la.

Acompanhe sua OS online:
${portalUrl}
Voce pode consultar o status e ate aprovar o orcamento direto pelo site!

${customerEmail ? `Historico enviado para: ${customerEmail}` : ''}
Verifique tambem a pasta de Spam/Lixo Eletronico

Precisando de algo sobre a logistica, nosso suporte esta a disposicao:
(11) 2626-3841
https://wa.me/551126263841

Obrigado pela confianca!
Equipe Pontual Tech`

    // ===== EMAIL HTML =====
    const emailHtml = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
  <div style="background: linear-gradient(135deg, #2563eb, #1d4ed8); padding: 24px; border-radius: 12px 12px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 22px;">Pontual Tech</h1>
    <p style="color: rgba(255,255,255,0.85); margin: 4px 0 0; font-size: 14px;">Confirmacao de Coleta</p>
  </div>

  <div style="background: #fff; border: 1px solid #e5e7eb; border-top: none; padding: 28px; border-radius: 0 0 12px 12px;">
    <p style="font-size: 16px; margin: 0 0 4px;">
      Tudo certo, <strong>${customerName}</strong>!
    </p>
    <p style="font-size: 15px; color: #555; margin: 0 0 20px;">
      OS ${osNumbers} aberta com sucesso! Seu agendamento ja esta com nossa logistica.
    </p>

    <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 16px; margin: 0 0 20px;">
      <p style="margin: 0 0 8px; font-size: 13px; color: #0369a1; font-weight: 600;">EQUIPAMENTOS PARA COLETA</p>
      ${allEquipments.map((e, i) => `
        <p style="margin: 0 0 4px; font-size: 14px;">
          <strong>${i + 1}.</strong> ${e.desc} <span style="color: #6b7280;">(OS #${e.num})</span>
        </p>
      `).join('')}
    </div>

    <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 16px; margin: 0 0 20px;">
      <p style="margin: 0 0 8px; font-size: 13px; color: #92400e; font-weight: 600;">INSTRUCOES PARA A COLETA</p>
      <p style="margin: 0 0 6px; font-size: 14px; color: #78350f;">
        A coleta ocorrera durante o <strong>horario comercial (09:00 as 17:00)</strong>.
      </p>
      <p style="margin: 0; font-size: 14px; color: #78350f;">
        Como seguimos uma rota, nao ha horario fixo. <strong>Deixe alguem avisado!</strong>
      </p>
    </div>

    <table style="width: 100%; border-collapse: collapse; margin: 0 0 20px;">
      <tr>
        <td style="padding: 12px; background: #f0fdf4; border-radius: 8px 0 0 8px; border: 1px solid #bbf7d0; width: 50%; vertical-align: top;">
          <p style="margin: 0 0 6px; font-size: 12px; color: #166534; font-weight: 600;">MANTENHA COM VOCE</p>
          <p style="margin: 0; font-size: 13px; color: #15803d;">Cabos de energia e fontes</p>
        </td>
        <td style="padding: 12px; background: #f0fdf4; border-radius: 0 8px 8px 0; border: 1px solid #bbf7d0; border-left: none; width: 50%; vertical-align: top;">
          <p style="margin: 0 0 6px; font-size: 12px; color: #166534; font-weight: 600;">PODE ENVIAR</p>
          <p style="margin: 0; font-size: 13px; color: #15803d;">O equipamento com os toners/cartuchos dentro</p>
        </td>
      </tr>
    </table>

    <div style="background: #faf5ff; border: 1px solid #e9d5ff; border-radius: 8px; padding: 16px; margin: 0 0 20px;">
      <p style="margin: 0 0 6px; font-size: 13px; color: #6b21a8; font-weight: 600;">ORCAMENTOS</p>
      <p style="margin: 0; font-size: 14px; color: #7c3aed;">
        Fique de olho no seu e-mail, pois o laudo sera enviado por la.
      </p>
    </div>

    <div style="text-align: center; margin: 0 0 20px;">
      <a href="${portalUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px;">
        Acompanhar minha OS online
      </a>
      <p style="margin: 8px 0 0; font-size: 12px; color: #9ca3af;">
        Consulte o status e aprove orcamentos direto pelo site
      </p>
    </div>

    ${customerEmail ? `
      <p style="font-size: 12px; color: #6b7280; margin: 0 0 4px;">
        Historico enviado para: <strong>${customerEmail}</strong>
      </p>
      <p style="font-size: 11px; color: #9ca3af; margin: 0 0 16px;">
        Verifique tambem a pasta de Spam/Lixo Eletronico
      </p>
    ` : ''}

    <div style="border-top: 1px solid #e5e7eb; padding-top: 16px; margin-top: 8px;">
      <p style="font-size: 13px; color: #555; margin: 0 0 4px;">
        Precisando de algo sobre a logistica:
      </p>
      <p style="font-size: 13px; margin: 0;">
        <a href="tel:+551126263841" style="color: #2563eb; text-decoration: none;">(11) 2626-3841</a>
        &nbsp;&bull;&nbsp;
        <a href="https://wa.me/551126263841" style="color: #16a34a; text-decoration: none;">WhatsApp</a>
      </p>
      <p style="font-size: 12px; color: #9ca3af; margin: 12px 0 0;">
        Obrigado pela confianca! — Equipe Pontual Tech
      </p>
    </div>
  </div>
</div>`

    const results: { channel: string; status: string }[] = []

    // Enviar email
    if (channels.includes('email') && customerEmail) {
      const sent = await sendEmail(
        customerEmail,
        `Confirmacao de Coleta — OS ${osNumbers} — Pontual Tech`,
        emailHtml
      )
      results.push({ channel: 'email', status: sent ? 'enviado' : 'erro' })
    } else if (channels.includes('email') && !customerEmail) {
      results.push({ channel: 'email', status: 'sem_email' })
    }

    // Enviar WhatsApp via Chatwoot
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

    return success({ results, osNumbers, customerName: customerFullName })
  } catch (err) {
    return handleError(err)
  }
}
