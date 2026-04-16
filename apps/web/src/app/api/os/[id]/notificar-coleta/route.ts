import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { sendCompanyEmail } from '@/lib/send-email'
import { sendWhatsAppTemplate } from '@/lib/whatsapp/cloud-api'
import { escapeHtml } from '@/lib/escape-html'
import { getCompanyContact } from '@/lib/company-contact'

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
      include: { customers: true, companies: true },
    })
    if (!os) return error('OS não encontrada', 404)

    const body = await req.json().catch(() => ({}))
    const channels: string[] = body.channels || ['email']

    const cc = await getCompanyContact(user.companyId)

    const { toTitleCase } = await import('@/lib/format-text')
    const customerName = toTitleCase(os.customers?.legal_name?.split(' ')[0] || 'Cliente')
    const customerFullName = toTitleCase(os.customers?.legal_name || 'Cliente')
    const customerEmail = os.customers?.email || ''
    const customerPhone = os.customers?.mobile || os.customers?.phone || ''
    const osNum = String(os.os_number).padStart(4, '0')
    const equipDesc = toTitleCase([os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' '))

    // Carregar settings da empresa
    const settings = await prisma.setting.findMany({ where: { company_id: user.companyId } })
    const cfg: Record<string, string> = {}
    for (const s of settings) cfg[s.key] = s.value

    const portalSlug = os.companies?.slug || 'default'
    const isImpri = portalSlug.includes('imprimitech')
    const portalDomain = cfg['portal.domain'] || (isImpri ? 'portal.imprimitech.com.br' : 'portal.pontualtech.com.br')
    const portalBase = `https://${portalDomain}/portal/${portalSlug}`
    const portalUrl = `${portalBase}/os/${os.id}`
    const companyName = os.companies?.name || cc.name
    const companyPhone = cc.phone
    const companyWebsite = cc.website
    const whatsappUrl = cc.whatsappUrl

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
        desc: toTitleCase([o.equipment_type, o.equipment_brand, o.equipment_model].filter(Boolean).join(' ')),
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
${companyPhone}
${whatsappUrl}

Obrigado pela confianca!
Equipe ${companyName}

⚙️ Esta e uma mensagem automatica.`

    // ===== EMAIL HTML =====
    const companyCnpj = cc.cnpj
    const companyEmail2 = cc.email
    const companyAddress = cc.address

    const emailHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          <!-- HEADER -->
          <tr>
            <td style="background:linear-gradient(135deg,#1e40af 0%,#2563eb 50%,#3b82f6 100%);padding:36px 32px;text-align:center;">
              <div style="width:56px;height:56px;background:rgba(255,255,255,0.15);border-radius:14px;margin:0 auto 12px;line-height:56px;font-size:28px;">&#128666;</div>
              <h1 style="margin:0 0 4px;color:#ffffff;font-size:22px;font-weight:800;">Confirmacao de Coleta</h1>
              <p style="margin:0;color:rgba(255,255,255,0.7);font-size:12px;">${escapeHtml(companyName)}</p>
            </td>
          </tr>
          <!-- BODY -->
          <tr>
            <td style="padding:32px 32px 0;">
              <p style="font-size:16px;margin:0 0 4px;color:#1e293b;">
                Tudo certo, <strong>${escapeHtml(customerName)}</strong>!
              </p>
              <p style="font-size:14px;color:#475569;margin:0 0 24px;line-height:1.7;">
                OS ${osNumbers} aberta com sucesso! Seu agendamento ja esta com nossa logistica.
              </p>

              <div style="background:#f8fafc;border:2px solid #e2e8f0;border-radius:10px;overflow:hidden;margin:0 0 24px;">
                <div style="background:#eff6ff;padding:10px 16px;border-bottom:1px solid #e2e8f0;">
                  <p style="margin:0;font-size:11px;color:#2563eb;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Equipamentos para Coleta</p>
                </div>
                <div style="padding:16px;">
                  ${allEquipments.map((e, i) => `
                    <p style="margin:0 0 6px;font-size:14px;color:#1e293b;">
                      <strong>${i + 1}.</strong> ${escapeHtml(e.desc)} <span style="color:#64748b;">(OS #${e.num})</span>
                    </p>
                  `).join('')}
                </div>
              </div>

              <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:16px;margin:0 0 20px;">
                <p style="margin:0 0 6px;font-size:11px;color:#92400e;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Instrucoes para a Coleta</p>
                <p style="margin:0 0 6px;font-size:14px;color:#78350f;line-height:1.5;">
                  A coleta ocorrera durante o <strong>horario comercial (09:00 as 17:00)</strong>.
                </p>
                <p style="margin:0;font-size:14px;color:#78350f;line-height:1.5;">
                  Como seguimos uma rota, nao ha horario fixo. <strong>Deixe alguem avisado!</strong>
                </p>
              </div>

              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 20px;">
                <tr>
                  <td style="padding:14px;background:#f0fdf4;border:1px solid #bbf7d0;width:50%;vertical-align:top;border-radius:8px 0 0 8px;">
                    <p style="margin:0 0 6px;font-size:11px;color:#166534;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Mantenha com voce</p>
                    <p style="margin:0;font-size:13px;color:#15803d;">Cabos de energia e fontes</p>
                  </td>
                  <td style="padding:14px;background:#f0fdf4;border:1px solid #bbf7d0;border-left:none;width:50%;vertical-align:top;border-radius:0 8px 8px 0;">
                    <p style="margin:0 0 6px;font-size:11px;color:#166534;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Pode enviar</p>
                    <p style="margin:0;font-size:13px;color:#15803d;">O equipamento com os toners/cartuchos dentro</p>
                  </td>
                </tr>
              </table>

              <div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:8px;padding:14px 16px;margin:0 0 24px;">
                <p style="margin:0 0 4px;font-size:11px;color:#6b21a8;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Orcamentos</p>
                <p style="margin:0;font-size:14px;color:#7c3aed;line-height:1.5;">
                  Fique de olho no seu e-mail, pois o laudo sera enviado por la.
                </p>
              </div>

              <div style="text-align:center;margin:0 0 16px;">
                <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td style="background:#2563eb;border-radius:8px;">
                  <a href="${portalUrl}" style="display:inline-block;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:14px 32px;">
                    Acompanhar minha OS online
                  </a>
                </td></tr></table>
                <p style="margin:8px 0 0;font-size:12px;color:#94a3b8;">Consulte o status e aprove orcamentos direto pelo site</p>
              </div>

              <div style="text-align:center;margin:0 0 32px;">
                <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td style="background:#25d366;border-radius:8px;">
                  <a href="${whatsappUrl}" style="display:inline-block;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;">
                    Fale com nosso suporte
                  </a>
                </td></tr></table>
              </div>

              ${customerEmail ? `
                <p style="font-size:12px;color:#64748b;margin:0 0 4px;">
                  Historico enviado para: <strong>${escapeHtml(customerEmail)}</strong>
                </p>
                <p style="font-size:11px;color:#94a3b8;margin:0 0 16px;">
                  Verifique tambem a pasta de Spam/Lixo Eletronico
                </p>
              ` : ''}
            </td>
          </tr>
          <!-- ACOMPANHE SUA OS -->
          <tr><td style="padding:0 32px 24px;">
            <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px;text-align:center;">
              <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#0369a1;">📱 Acompanhe sua OS</p>
              <p style="margin:0 0 12px;font-size:13px;color:#0c4a6e;">Acesse o Portal do Cliente ou consulte pelo nosso site:</p>
              <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
                <td style="padding:0 6px;"><a href="${portalBase}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">Portal do Cliente</a></td>
                <td style="padding:0 6px;"><a href="${companyWebsite}/#consulta-os" style="display:inline-block;padding:10px 20px;background:#0ea5e9;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">Consultar no Site</a></td>
              </tr></table>
              <p style="margin:12px 0 0;font-size:13px;color:#0c4a6e;">Duvidas? Fale com nosso suporte:</p>
              <table cellpadding="0" cellspacing="0" style="margin:8px auto 0;"><tr>
                <td><a href="${whatsappUrl}" style="display:inline-block;padding:10px 24px;background:#25d366;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">💬 WhatsApp Suporte</a></td>
              </tr></table>
            </div>
          </td></tr>
          <!-- FOOTER -->
          <tr>
            <td style="background:#1e293b;padding:28px 32px;text-align:center;">
              <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#ffffff;">${escapeHtml(companyName)}</p>
              <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">Assistencia Tecnica em Informatica</p>
              <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">${escapeHtml(companyAddress)}</p>
              <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">CNPJ: ${escapeHtml(companyCnpj)}</p>
              <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">Tel: ${escapeHtml(companyPhone)} | ${escapeHtml(companyEmail2)}</p>
              <div style="border-top:1px solid #334155;padding-top:10px;margin-top:10px;">
                <p style="margin:0;font-size:10px;color:#64748b;">⚙️ Esta e uma mensagem automatica. Nao responda diretamente este email.</p>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

    const results: { channel: string; status: string }[] = []

    // Enviar email
    if (channels.includes('email') && customerEmail) {
      const sent = await sendCompanyEmail(
        user.companyId,
        customerEmail,
        `Confirmacao de Coleta — OS ${osNumbers} — ${companyName}`,
        emailHtml
      )
      results.push({ channel: 'email', status: sent ? 'enviado' : 'erro' })
    } else if (channels.includes('email') && !customerEmail) {
      results.push({ channel: 'email', status: 'sem_email' })
    }

    // Enviar WhatsApp via Meta Cloud API template (fallback to Evolution for companies without Cloud API)
    if (channels.includes('whatsapp') && customerPhone) {
      try {
        const phone = customerPhone.replace(/\D/g, '')
        const waResult = await sendWhatsAppTemplate(
          user.companyId, phone, 'pt_coleta_v2', 'pt_BR',
          [{ type: 'body', parameters: [{ type: 'text', text: osNum }] }],
          whatsappMsg // fallback text for Evolution API
        )
        if (waResult.success) {
          results.push({ channel: 'whatsapp', status: 'enviado' })
        } else {
          console.error('[Coleta] WhatsApp send failed:', waResult.error)
          results.push({ channel: 'whatsapp', status: 'erro', error: waResult.error } as any)
        }
      } catch (err) {
        console.error('[Coleta] WhatsApp exception:', err)
        results.push({ channel: 'whatsapp', status: 'erro' })
      }
    } else if (channels.includes('whatsapp') && !customerPhone) {
      results.push({ channel: 'whatsapp', status: 'sem_telefone' })
    }

    // ── Sync contact to Chatwoot (update name, email, custom attributes) ──
    try {
      const cwUrl = cfg['chatwoot.url'] || (isImpri ? 'https://chat.imp.pontualtech.work' : 'https://chat.pontualtech.work')
      const cwToken = cfg['chatwoot.api_token'] || cfg['chatwoot.admin_token'] || ''
      const cwAccount = cfg['chatwoot.account_id'] || '1'
      if (cwToken && customerPhone) {
        const phone = customerPhone.replace(/\D/g, '')
        const searchPhone = phone.startsWith('55') ? `+${phone}` : `+55${phone}`
        const searchRes = await fetch(`${cwUrl}/api/v1/accounts/${cwAccount}/contacts/search?q=${encodeURIComponent(searchPhone)}`, {
          headers: { api_access_token: cwToken },
          signal: AbortSignal.timeout(5000),
        })
        if (searchRes.ok) {
          const searchData = await searchRes.json()
          const contact = searchData.payload?.[0]
          if (contact) {
            const customerAddr = os.customers?.address_street || ''
            const customerCity = os.customers?.address_city || ''
            await fetch(`${cwUrl}/api/v1/accounts/${cwAccount}/contacts/${contact.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', api_access_token: cwToken },
              body: JSON.stringify({
                name: customerFullName || contact.name,
                email: customerEmail || contact.email || undefined,
                custom_attributes: {
                  ...contact.custom_attributes,
                  os_numeros: allEquipments.map(e => `#${e.num}`).join(', '),
                  equipamentos: allEquipments.map(e => e.desc).join(', '),
                  endereco: customerAddr ? `${customerAddr}${customerCity ? ` — ${customerCity}` : ''}` : undefined,
                  cpf_cnpj: os.customers?.document_number || undefined,
                  coleta_agendada: new Date().toISOString().split('T')[0],
                },
              }),
              signal: AbortSignal.timeout(5000),
            })
            results.push({ channel: 'chatwoot_sync', status: 'atualizado' })
            console.log(`[Coleta] Chatwoot contact ${contact.id} updated for ${customerFullName}`)
          }
        }
      }
    } catch (cwErr) {
      console.error('[Coleta] Chatwoot sync error:', cwErr)
      results.push({ channel: 'chatwoot_sync', status: 'erro' })
    }

    return success({ results, osNumbers, customerName: customerFullName })
  } catch (err) {
    return handleError(err)
  }
}
