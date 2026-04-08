import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { sendEmail } from '@/lib/send-email'
import { createHmac } from 'crypto'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

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
        quotes: {
          orderBy: { version: 'desc' },
          take: 1,
          include: { quote_items: true },
        },
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

    // Use latest quote version items if available, otherwise fall back to OS items
    const latestQuote = os.quotes[0] ?? null
    const items = latestQuote
      ? latestQuote.quote_items.map(item => ({
          id: item.id,
          description: item.description,
          item_type: 'SERVICO' as const,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total_price: item.total_price,
        }))
      : os.service_order_items.map(item => ({
          id: item.id,
          description: item.description,
          item_type: item.item_type,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total_price: item.total_price,
        }))

    const totalFromQuote = latestQuote ? (latestQuote.total_amount || 0) : null

    return success({
      id: os.id,
      os_number: os.os_number,
      equipment_type: os.equipment_type,
      equipment_brand: os.equipment_brand,
      equipment_model: os.equipment_model,
      serial_number: os.serial_number,
      reported_issue: os.reported_issue,
      diagnosis: os.diagnosis,
      total_cost: totalFromQuote ?? (os.total_cost || 0),
      total_parts: latestQuote ? 0 : (os.total_parts || 0),
      total_services: latestQuote ? (latestQuote.total_amount || 0) : (os.total_services || 0),
      status: os.module_statuses?.name || '—',
      items,
      quote_version: latestQuote?.version ?? null,
      customer_name: os.customers?.legal_name || '—',
      customer_person_type: os.customers?.person_type || 'FISICA',
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
    const ip = getClientIp(request)
    const { allowed } = rateLimit(ip, 10, 60000) // 10 per minute
    if (!allowed) {
      return NextResponse.json({ error: 'Muitas tentativas. Aguarde um momento.' }, { status: 429 })
    }

    const body = await request.json()
    const { token, slug, action, reason, payment_method, discounted_cost, discount_percent } = body as {
      token?: string
      slug?: string
      action?: 'approve' | 'reject'
      reason?: string
      payment_method?: string
      discounted_cost?: number
      discount_percent?: number
    }

    // Capturar IP do cliente
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'IP desconhecido'

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
      const currentStatusName = os.module_statuses?.name?.toLowerCase() || ''

      // Só pode aprovar se está "Aguardando Aprovação" ou "Recusado" (mudou de ideia)
      const podeAprovar = currentStatusName.includes('aguardando aprov') || currentStatusName.includes('recusad')
      if (!podeAprovar) {
        return error('Este orçamento não está disponível para aprovação. Status atual: ' + (os.module_statuses?.name || '—') + '. Entre em contato com nosso suporte.', 410)
      }

      // Bloquear se valor é zero
      if (!os.total_cost || os.total_cost <= 0) {
        return error('Orçamento sem valor definido. Aguarde a equipe técnica finalizar o laudo.', 400)
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

      // Determinar valor aprovado (com ou sem desconto)
      const hasDiscount = typeof discounted_cost === 'number' && discounted_cost > 0 && discounted_cost < (os.total_cost || 0)
      const approvedCostValue = hasDiscount ? discounted_cost : (os.total_cost || 0)
      const discountNote = hasDiscount ? ` — COM DESCONTO de ${discount_percent || '?'}% (de ${fmtCents(os.total_cost || 0)} para ${fmtCents(discounted_cost)})` : ''

      // Nota interna com data, hora e IP
      const now = new Date()
      const dataHora = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
      const notaAprovacao = `[${dataHora}] Orcamento APROVADO pelo cliente via portal (IP: ${clientIp})${payment_method ? ' — Pagamento: ' + payment_method : ''}${discountNote}`
      const currentNotes = os.internal_notes || ''

      // Transição atômica
      await prisma.$transaction(async (tx) => {
        await tx.serviceOrder.update({
          where: { id: os.id },
          data: {
            status_id: approvedStatus.id,
            approved_cost: approvedCostValue,
            estimated_delivery: estimatedDelivery,
            payment_method: payment_method || os.payment_method || null,
            internal_notes: currentNotes ? `${currentNotes}\n${notaAprovacao}` : notaAprovacao,
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
            notes: hasDiscount ? `Orcamento aprovado COM DESCONTO de ${discount_percent || '?'}% pelo cliente via portal` : 'Orçamento aprovado pelo cliente via portal',
          },
        })
      })

      const osNum = String(os.os_number).padStart(4, '0')
      const customerName = os.customers?.legal_name || 'Cliente'
      const customerFirstName = customerName.split(' ')[0]
      const fmtValue = fmtCents(approvedCostValue)
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
        newValue: { customer_name: customerName, os_number: os.os_number, total_cost: os.total_cost, approved_cost: approvedCostValue, discount_percent: hasDiscount ? discount_percent : null, estimated_delivery: previsaoStr },
      })

      // 1. Aviso interno URGENTE para técnicos
      await prisma.announcement.create({
        data: {
          company_id: os.company_id,
          title: `✅ OS ${osNum} APROVADA — ${customerName}`,
          message: `O cliente ${customerName} aprovou o orçamento da OS ${osNum} (${equipment}) no valor de ${fmtValue}${hasDiscount ? ` (COM DESCONTO de ${discount_percent}% — valor original: ${fmtCents(os.total_cost || 0)})` : ''}.\n\nPrevisão de entrega: ${previsaoStr} (10 dias úteis).\n\nIniciar o reparo imediatamente!`,
          priority: 'URGENTE',
          require_read: true,
          author_name: 'Sistema',
          created_by: 'portal',
        },
      })

      // 2. Email de confirmação ao cliente
      const customerEmail = os.customers?.email
      const companyEmailAddr = cfg['company.email'] || cfg['email'] || 'contato@pontualtech.com.br'
      const companyCnpj = cfg['company.cnpj'] || cfg['cnpj'] || '32.772.178/0001-47'
      const companyAddress = cfg['company.address'] || cfg['endereco'] || 'Rua Ouvidor Peleja, 660 — Vila Mariana — CEP 04128-001 — Sao Paulo/SP'
      if (customerEmail) {
        const emailHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#15803d 0%,#22c55e 100%);padding:36px 32px;text-align:center;">
              <div style="width:56px;height:56px;background:rgba(255,255,255,0.15);border-radius:14px;margin:0 auto 12px;line-height:56px;font-size:28px;">&#9989;</div>
              <h1 style="margin:0 0 4px;color:#ffffff;font-size:22px;font-weight:800;">Orcamento Aprovado!</h1>
              <p style="margin:0;color:rgba(255,255,255,0.7);font-size:12px;">${companyName}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 32px 0;">
              <p style="font-size:16px;margin:0 0 16px;color:#1e293b;">Ola <strong>${customerFirstName}</strong>,</p>
              <p style="font-size:14px;color:#475569;margin:0 0 24px;line-height:1.7;">
                Seu orcamento para a OS <strong>#${osNum}</strong> foi aprovado com sucesso!
                Nossa equipe tecnica ja esta ciente e o reparo comeca a partir de agora.
              </p>

              <div style="background:#f8fafc;border:2px solid #e2e8f0;border-radius:10px;overflow:hidden;margin:0 0 24px;">
                <div style="padding:16px;">
                  <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#1e293b;">
                    <tr><td style="padding:6px 0;font-weight:700;width:150px;color:#64748b;">Equipamento:</td><td style="padding:6px 0;font-weight:600;">${equipment}</td></tr>
                    <tr><td style="padding:6px 0;font-weight:700;color:#64748b;">Valor aprovado:</td><td style="padding:6px 0;font-weight:800;font-size:18px;color:#15803d;">${fmtValue}</td></tr>
                    <tr><td style="padding:6px 0;font-weight:700;color:#64748b;">Previsao entrega:</td><td style="padding:6px 0;font-weight:700;">${previsaoStr}</td></tr>
                    <tr><td style="padding:6px 0;font-weight:700;color:#64748b;">Prazo:</td><td style="padding:6px 0;">10 dias uteis a partir de hoje</td></tr>
                  </table>
                </div>
              </div>

              <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;margin:0 0 24px;">
                <p style="margin:0;font-size:14px;color:#1e40af;line-height:1.6;">
                  <strong>Proximo passo:</strong> Nossa equipe vai iniciar o reparo e voce sera notificado quando o equipamento estiver pronto para retirada/entrega.
                </p>
              </div>

              <div style="text-align:center;margin:0 0 32px;">
                <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td style="background:#25d366;border-radius:8px;">
                  <a href="${whatsappUrl}" style="display:inline-block;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;">
                    Fale com nosso suporte
                  </a>
                </td></tr></table>
              </div>
            </td>
          </tr>
          <tr>
            <td style="background:#1e293b;padding:24px 32px;text-align:center;">
              <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#ffffff;">${companyName}</p>
              <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">Assistencia Tecnica em Informatica</p>
              <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">${companyAddress}</p>
              <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">CNPJ: ${companyCnpj} | Tel: ${companyPhone} | ${companyEmailAddr}</p>
              <div style="border-top:1px solid #334155;padding-top:10px;margin-top:10px;">
                <p style="margin:0;font-size:10px;color:#64748b;">Garantia de 3 meses em todos os servicos</p>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
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
      const currentStatusName2 = os.module_statuses?.name?.toLowerCase() || ''

      // Só pode recusar se está "Aguardando Aprovação"
      const podeRecusar = currentStatusName2.includes('aguardando aprov')
      if (!podeRecusar) {
        if (currentStatusName2.includes('recusad')) {
          return error('Este orçamento já foi recusado anteriormente.', 410)
        }
        return error('Este orçamento não pode ser recusado no status atual (' + (os.module_statuses?.name || '—') + '). Entre em contato com nosso suporte pelo WhatsApp: https://wa.me/551126263841', 410)
      }

      // Buscar status "Recusado" — NUNCA usar Cancelada (são coisas diferentes)
      const targetStatus = await prisma.moduleStatus.findFirst({
        where: { company_id: os.company_id, module: 'os', name: { contains: 'Recusad', mode: 'insensitive' } },
      })

      const now2 = new Date()
      const dataHora2 = now2.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
      const rejectionNote = `[${dataHora2}] Orcamento RECUSADO pelo cliente via portal (IP: ${clientIp})${reason ? ' — Motivo: ' + reason : ''}`
      const osNum2 = String(os.os_number).padStart(4, '0')
      const customerName2 = os.customers?.legal_name || 'Cliente'
      const equipment2 = [os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' ')
      const fmtValue2 = fmtCents(os.total_cost || 0)

      // Transação atômica
      await prisma.$transaction(async (tx) => {
        const updateData: any = {
          internal_notes: os.internal_notes ? `${os.internal_notes}\n${rejectionNote}` : rejectionNote,
          updated_at: new Date(),
        }
        if (targetStatus) updateData.status_id = targetStatus.id

        await tx.serviceOrder.update({ where: { id: os.id }, data: updateData })

        if (targetStatus) {
          await tx.serviceOrderHistory.create({
            data: {
              company_id: os.company_id,
              service_order_id: os.id,
              from_status_id: os.status_id,
              to_status_id: targetStatus.id,
              changed_by: 'portal',
              notes: rejectionNote,
            },
          })
        }
      })

      logAudit({
        companyId: os.company_id,
        userId: 'portal',
        module: 'os',
        action: 'quote_rejected_by_customer',
        entityId: os.id,
        newValue: { customer_name: customerName2, os_number: os.os_number, total_cost: os.total_cost, reason: reason || null },
      })

      // Carregar settings
      const settings2 = await prisma.setting.findMany({ where: { company_id: os.company_id } })
      const cfg2: Record<string, string> = {}
      for (const s of settings2) cfg2[s.key] = s.value
      const whatsappUrl2 = `https://wa.me/${(cfg2['company.whatsapp'] || '551126263841').replace(/\D/g, '')}`
      const companyPhone2 = cfg2['company.phone'] || '(11) 2626-3841'
      const companyName2 = os.companies.name || 'Empresa'

      // 1. Aviso interno URGENTE para atendimento + financeiro
      await prisma.announcement.create({
        data: {
          company_id: os.company_id,
          title: `❌ OS ${osNum2} RECUSADA — ${customerName2}`,
          message: `O cliente ${customerName2} recusou o orçamento da OS ${osNum2} (${equipment2}) no valor de ${fmtValue2}.${reason ? `\n\nMotivo: "${reason}"` : ''}\n\nAÇÕES NECESSÁRIAS:\n• Atendimento: entrar em contato para negociar\n• Financeiro: verificar se há custos a recuperar\n• Logística: agendar devolução do equipamento`,
          priority: 'URGENTE',
          require_read: true,
          author_name: 'Sistema',
          created_by: 'portal',
        },
      })

      // 2. Email ao cliente confirmando a recusa
      const customerEmail2 = os.customers?.email
      const companyEmailAddr2 = cfg2['company.email'] || cfg2['email'] || 'contato@pontualtech.com.br'
      const companyCnpj2 = cfg2['company.cnpj'] || cfg2['cnpj'] || '32.772.178/0001-47'
      const companyAddress2 = cfg2['company.address'] || cfg2['endereco'] || 'Rua Ouvidor Peleja, 660 — Vila Mariana — CEP 04128-001 — Sao Paulo/SP'
      if (customerEmail2) {
        const emailHtml2 = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#1e40af 0%,#2563eb 50%,#3b82f6 100%);padding:36px 32px;text-align:center;">
              <div style="width:56px;height:56px;background:rgba(255,255,255,0.15);border-radius:14px;margin:0 auto 12px;line-height:56px;font-size:28px;">&#128203;</div>
              <h1 style="margin:0 0 4px;color:#ffffff;font-size:22px;font-weight:800;">Orcamento Recusado</h1>
              <p style="margin:0;color:rgba(255,255,255,0.7);font-size:12px;">${companyName2}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 32px 0;">
              <p style="font-size:16px;margin:0 0 16px;color:#1e293b;">Ola <strong>${customerName2.split(' ')[0]}</strong>,</p>
              <p style="font-size:14px;color:#475569;margin:0 0 24px;line-height:1.7;">
                Recebemos sua decisao sobre o orcamento da OS <strong>#${osNum2}</strong>.
                Entendemos e respeitamos sua escolha.
              </p>

              <div style="background:#f8fafc;border:2px solid #e2e8f0;border-radius:10px;overflow:hidden;margin:0 0 24px;">
                <div style="padding:16px;">
                  <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#1e293b;">
                    <tr><td style="padding:6px 0;font-weight:700;width:130px;color:#64748b;">Equipamento:</td><td style="padding:6px 0;">${equipment2}</td></tr>
                    <tr><td style="padding:6px 0;font-weight:700;color:#64748b;">Valor orcado:</td><td style="padding:6px 0;font-weight:600;">${fmtValue2}</td></tr>
                    ${reason ? `<tr><td style="padding:6px 0;font-weight:700;color:#64748b;">Motivo:</td><td style="padding:6px 0;">${reason}</td></tr>` : ''}
                  </table>
                </div>
              </div>

              <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;margin:0 0 24px;">
                <p style="margin:0;font-size:14px;color:#1e40af;line-height:1.6;">
                  <strong>Quer negociar?</strong> Nossa equipe esta disponivel para revisar o orcamento ou esclarecer duvidas. Entre em contato pelo WhatsApp!
                </p>
              </div>

              <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:14px 16px;margin:0 0 24px;">
                <p style="margin:0;font-size:13px;color:#92400e;line-height:1.5;">
                  <strong>Importante:</strong> Seu equipamento esta conosco. Entraremos em contato para combinar a devolucao.
                </p>
              </div>

              <div style="text-align:center;margin:0 0 32px;">
                <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td style="background:#25d366;border-radius:8px;">
                  <a href="${whatsappUrl2}" style="display:inline-block;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;">
                    Fale com nosso suporte
                  </a>
                </td></tr></table>
              </div>
            </td>
          </tr>
          <tr>
            <td style="background:#1e293b;padding:24px 32px;text-align:center;">
              <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#ffffff;">${companyName2}</p>
              <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">Assistencia Tecnica em Informatica</p>
              <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">${companyAddress2}</p>
              <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">CNPJ: ${companyCnpj2} | Tel: ${companyPhone2} | ${companyEmailAddr2}</p>
              <div style="border-top:1px solid #334155;padding-top:10px;margin-top:10px;">
                <p style="margin:0;font-size:10px;color:#64748b;">Garantia de 3 meses em todos os servicos</p>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
        sendEmail(customerEmail2, `Orcamento OS #${osNum2} — ${companyName2}`, emailHtml2).catch(() => {})
      }

      return success({ action: 'rejected', message: 'Orçamento recusado. A empresa foi notificada.' })
    }

    return error('Ação inválida', 400)
  } catch (err) {
    return handleError(err)
  }
}
