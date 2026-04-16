import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { sendCompanyEmail } from '@/lib/send-email'
import { createHmac } from 'crypto'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { escapeHtml } from '@/lib/escape-html'

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

    // Detect recalculated quote
    const statusName = os.module_statuses?.name || ''
    const isRecalculado = /recalculad/i.test(statusName)
    const customData = (os.custom_data || {}) as Record<string, any>
    const originalCost = customData.original_cost || 0
    const currentCost = totalFromQuote ?? (os.total_cost || 0)
    const hasRecalcDiscount = isRecalculado && originalCost > 0 && originalCost > currentCost
    // Normal discount from DB
    const dbDiscount = os.discount_amount ?? 0
    const subtotal = (os.total_parts ?? 0) + (os.total_services ?? 0)
    const hasNormalDiscount = !hasRecalcDiscount && dbDiscount > 0 && subtotal > 0
    const hasDiscount = hasRecalcDiscount || hasNormalDiscount
    const maxInstallments = isRecalculado ? 5 : parseInt(settingsMap['quote.max_installments'] || '3') || 3

    const { toTitleCase } = await import('@/lib/format-text')

    return success({
      id: os.id,
      os_number: os.os_number,
      equipment_type: toTitleCase(os.equipment_type || ''),
      equipment_brand: toTitleCase(os.equipment_brand || ''),
      equipment_model: toTitleCase(os.equipment_model || ''),
      serial_number: os.serial_number,
      reported_issue: os.reported_issue,
      diagnosis: os.diagnosis,
      total_cost: currentCost,
      total_parts: latestQuote ? 0 : (os.total_parts || 0),
      total_services: latestQuote ? (latestQuote.total_amount || 0) : (os.total_services || 0),
      status: statusName,
      items,
      quote_version: latestQuote?.version ?? null,
      customer_name: toTitleCase(os.customers?.legal_name || '—'),
      customer_person_type: os.customers?.person_type || 'FISICA',
      discount_amount: hasDiscount ? (hasRecalcDiscount ? originalCost - currentCost : dbDiscount) : null,
      is_recalculado: isRecalculado,
      original_cost: hasRecalcDiscount ? originalCost : (hasNormalDiscount ? subtotal : null),
      discount_percent: hasDiscount
        ? (hasRecalcDiscount
            ? Math.round(((originalCost - currentCost) / originalCost) * 100)
            : Math.round((dbDiscount / subtotal) * 100))
        : null,
      max_installments: maxInstallments,
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

      // Valor aprovado = total_cost da OS (definido pelo ERP, nunca pelo cliente)
      // SECURITY: discounted_cost do body é IGNORADO — desconto só pode ser aplicado
      // pelo ERP internamente via discount_amount no service_order
      const approvedCostValue = os.total_cost || 0
      const discountNote = ''

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
            notes: false ?`Orcamento aprovado COM DESCONTO de ${discount_percent || '?'}% pelo cliente via portal` : 'Orçamento aprovado pelo cliente via portal',
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
        newValue: { customer_name: customerName, os_number: os.os_number, total_cost: os.total_cost, approved_cost: approvedCostValue, discount_percent: false ?discount_percent : null, estimated_delivery: previsaoStr },
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

      // 2. Email de confirmação ao cliente (template editável via Settings)
      const customerEmail = os.customers?.email
      const companyEmailAddr = cfg['company.email'] || cfg['email'] || ''
      const companyCnpj = cfg['cnab.cnpj'] || cfg['company.cnpj'] || ''
      const companyAddress = [cfg['cnab.endereco'], cfg['company.number'], cfg['cnab.bairro'], cfg['cnab.cidade'], cfg['cnab.uf']].filter(Boolean).join(', ') || ''
      const companyCep = cfg['cnab.cep'] || ''
      const pixKey = cfg['pix.chave'] || companyCnpj
      const pixBanco = cfg['pix.banco'] || ''
      const horario = cfg['company.horario'] || 'Seg a Qui 08:00-18:00 | Sex 08:00-17:00'

      if (customerEmail) {
        // Try to load custom template from DB, fallback to built-in
        const customTemplate = await prisma.setting.findFirst({
          where: { company_id: os.company_id, key: 'email.template_aprovacao' },
        })

        let emailHtml: string
        if (customTemplate?.value) {
          // Custom template with variable replacement
          emailHtml = customTemplate.value
            .replace(/\{\{cliente_nome\}\}/g, escapeHtml(customerFirstName))
            .replace(/\{\{cliente_nome_completo\}\}/g, escapeHtml(customerName))
            .replace(/\{\{os_numero\}\}/g, String(osNum))
            .replace(/\{\{equipamento\}\}/g, escapeHtml(equipment))
            .replace(/\{\{valor\}\}/g, fmtValue)
            .replace(/\{\{previsao\}\}/g, previsaoStr)
            .replace(/\{\{empresa_nome\}\}/g, escapeHtml(companyName))
            .replace(/\{\{empresa_endereco\}\}/g, escapeHtml(companyAddress))
            .replace(/\{\{empresa_cep\}\}/g, escapeHtml(companyCep))
            .replace(/\{\{empresa_cnpj\}\}/g, escapeHtml(companyCnpj))
            .replace(/\{\{empresa_telefone\}\}/g, escapeHtml(companyPhone))
            .replace(/\{\{empresa_email\}\}/g, escapeHtml(companyEmailAddr))
            .replace(/\{\{empresa_whatsapp\}\}/g, whatsappUrl)
            .replace(/\{\{pix_chave\}\}/g, escapeHtml(pixKey))
            .replace(/\{\{pix_banco\}\}/g, escapeHtml(pixBanco))
            .replace(/\{\{horario\}\}/g, escapeHtml(horario))
        } else {
          // Built-in professional template
          emailHtml = buildApprovalEmailHtml({
            customerFirstName, osNum: String(osNum), equipment, fmtValue, previsaoStr,
            companyName, companyAddress, companyCep, companyCnpj, companyPhone,
            companyEmailAddr, whatsappUrl, pixKey, pixBanco, horario,
            companyWebsite: cfg['company.website'] || 'https://pontualtech.com.br',
            portalUrl: (process.env.PORTAL_URL || 'https://portal.pontualtech.com.br') + '/portal/' + os.companies.slug,
          })
        }

        sendCompanyEmail(os.company_id, customerEmail, `Aprovacao Confirmada — Orcamento #${osNum} — ${companyName}`, emailHtml).catch(() => {})
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

      // Buscar status "Orçar Negociar" — cliente recusou, mas vamos tentar renegociar
      // Fallback para "Recusado" se Orçar Negociar não existir
      let targetStatus = await prisma.moduleStatus.findFirst({
        where: { company_id: os.company_id, module: 'os', name: { contains: 'Negociar', mode: 'insensitive' } },
      })
      if (!targetStatus) {
        targetStatus = await prisma.moduleStatus.findFirst({
          where: { company_id: os.company_id, module: 'os', name: { contains: 'Recusad', mode: 'insensitive' } },
        })
      }

      const now2 = new Date()
      const dataHora2 = now2.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
      const rejectionNote = `[${dataHora2}] Orcamento RECUSADO pelo cliente via portal (IP: ${clientIp})${reason ? ' — Motivo: ' + reason : ''}`
      const osNum2 = String(os.os_number).padStart(4, '0')
      const customerName2 = os.customers?.legal_name || 'Cliente'
      const equipment2 = [os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' ')
      const fmtValue2 = fmtCents(os.total_cost || 0)

      // Count previous rejections to determine 1st vs 2nd rejection
      const rejectionCount = await prisma.serviceOrderHistory.count({
        where: {
          service_order_id: os.id,
          notes: { contains: 'RECUSADO pelo cliente' },
        },
      })
      const isSecondRejection = rejectionCount >= 1 // This is the 2nd+ rejection

      // For 2nd rejection: use "Renegociar" status instead
      if (isSecondRejection) {
        const renegociarStatus = await prisma.moduleStatus.findFirst({
          where: { company_id: os.company_id, module: 'os', name: { contains: 'Renegociar', mode: 'insensitive' } },
        })
        if (renegociarStatus) targetStatus = renegociarStatus
      }

      // Save original_cost in custom_data (for recalculated comparison)
      const customData = (os.custom_data || {}) as Record<string, any>
      if (!customData.original_cost && os.total_cost) {
        customData.original_cost = os.total_cost
      }
      customData.rejection_count = rejectionCount + 1
      customData.last_rejection_reason = reason || null
      customData.last_rejection_at = new Date().toISOString()

      // Transação atômica
      await prisma.$transaction(async (tx) => {
        const updateData: any = {
          internal_notes: os.internal_notes ? `${os.internal_notes}\n${rejectionNote}` : rejectionNote,
          updated_at: new Date(),
          custom_data: customData,
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

      // 1. Aviso interno URGENTE
      if (isSecondRejection) {
        // 2ª recusa: aviso especial para ADMIN
        await prisma.announcement.create({
          data: {
            company_id: os.company_id,
            title: `🔴 OS ${osNum2} RECUSADA 2x — ADMIN DEVE INTERVIR — ${customerName2}`,
            message: `O cliente ${customerName2} recusou o orçamento da OS ${osNum2} (${equipment2}) pela SEGUNDA VEZ.\nValor: ${fmtValue2}${reason ? `\nMotivo: "${reason}"` : ''}\n\n⚠️ STATUS: RENEGOCIAR — requer análise do administrador.\n\nAÇÕES:\n• Administrador: analisar caso e decidir desconto máximo\n• Verificar se vale manter a negociação\n• Se inviável: agendar devolução do equipamento`,
            priority: 'URGENTE',
            require_read: true,
            author_name: 'Sistema',
            created_by: 'portal',
          },
        })
      } else {
        // 1ª recusa: aviso para atendimento
        await prisma.announcement.create({
          data: {
            company_id: os.company_id,
            title: `❌ OS ${osNum2} RECUSADA — ${customerName2}`,
            message: `O cliente ${customerName2} recusou o orçamento da OS ${osNum2} (${equipment2}) no valor de ${fmtValue2}.${reason ? `\n\nMotivo: "${reason}"` : ''}\n\nAÇÕES NECESSÁRIAS:\n• Atendimento: entrar em contato para negociar\n• Financeiro: verificar se há custos a recuperar`,
            priority: 'URGENTE',
            require_read: true,
            author_name: 'Sistema',
            created_by: 'portal',
          },
        })
      }

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
          <tr><td style="padding:0 32px 24px;">
            <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px;text-align:center;">
              <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#0369a1;">📱 Acompanhe sua OS</p>
              <p style="margin:0 0 12px;font-size:13px;color:#0c4a6e;">Acesse o Portal do Cliente ou consulte pelo nosso site:</p>
              <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
                <td style="padding:0 6px;"><a href="${(() => { const pb = process.env.PORTAL_URL || 'https://portal.pontualtech.com.br'; return pb + '/portal/' + os.companies.slug; })()}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">Portal do Cliente</a></td>
                <td style="padding:0 6px;"><a href="${(cfg2['company.website'] || 'https://pontualtech.com.br') + '/#consulta-os'}" style="display:inline-block;padding:10px 20px;background:#0ea5e9;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">Consultar no Site</a></td>
              </tr></table>
              <p style="margin:12px 0 0;font-size:13px;color:#0c4a6e;">Duvidas? Fale com nosso suporte:</p>
              <table cellpadding="0" cellspacing="0" style="margin:8px auto 0;"><tr>
                <td><a href="${whatsappUrl2}" style="display:inline-block;padding:10px 24px;background:#25d366;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">💬 WhatsApp Suporte</a></td>
              </tr></table>
            </div>
          </td></tr>
          <tr>
            <td style="background:#1e293b;padding:24px 32px;text-align:center;">
              <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#ffffff;">${companyName2}</p>
              <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">Assistencia Tecnica em Informatica</p>
              <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">${companyAddress2}</p>
              <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">CNPJ: ${companyCnpj2} | Tel: ${companyPhone2} | ${companyEmailAddr2}</p>
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
        sendCompanyEmail(os.company_id, customerEmail2, `Orcamento OS #${osNum2} — ${companyName2}`, emailHtml2).catch(() => {})
      }

      // 3. Post-rejection actions (differs by rejection count)
      if (isSecondRejection) {
        // 2ª recusa: enviar mensagem "setor responsável informado", SEM retenção
        const customerPhone2 = os.customers?.mobile || os.customers?.phone
        if (customerPhone2) {
          const waText = `Ola ${customerName2.split(' ')[0]}, recebemos seu retorno sobre a OS #${osNum2}.\n\nSeu caso ja foi encaminhado ao setor responsavel para analise. Entraremos em contato em breve com uma posicao definitiva.\n\nEquipe ${companyName2}`
          try {
            const { sendWhatsAppCloud } = await import('@/lib/whatsapp/cloud-api')
            await sendWhatsAppCloud(os.company_id, customerPhone2, waText)
          } catch {} // fire and forget
        }
        return success({ action: 'rejected', message: 'Orçamento recusado pela segunda vez. Setor responsável será notificado.' })
      } else {
        // 1ª recusa: RETENCAO — 5 minutos depois, enviar email + WhatsApp de negociacao
        const retentionData = {
          companyId: os.company_id,
          osId: os.id,
          osNum: osNum2,
          customerName: customerName2,
          customerEmail: customerEmail2,
          customerPhone: os.customers?.mobile || os.customers?.phone,
          equipment: equipment2,
          value: fmtValue2,
          companyName: companyName2,
          companyPhone: companyPhone2,
          companyAddress: companyAddress2,
          companyCnpj: companyCnpj2,
          companyEmail: companyEmailAddr2,
          companyWebsite: cfg2['company.website'] || '',
          whatsappUrl: whatsappUrl2,
          portalUrl: `${process.env.PORTAL_URL || 'https://portal.pontualtech.com.br'}/portal/${os.companies.slug}/login`,
          reason: reason || '',
          slug: os.companies.slug,
        }
        setTimeout(() => sendRetentionMessage(retentionData).catch(e => console.error('[Retention] Error:', e)), 5 * 60 * 1000)
        return success({ action: 'rejected', message: 'Orçamento recusado. Estamos preparando uma nova proposta.' })
      }
    }

    return error('Ação inválida', 400)
  } catch (err) {
    return handleError(err)
  }
}

// ---------------------------------------------------------------------------
// Professional approval email template (built-in default)
// ---------------------------------------------------------------------------

interface ApprovalEmailData {
  customerFirstName: string; osNum: string; equipment: string; fmtValue: string
  previsaoStr: string; companyName: string; companyAddress: string; companyCep: string
  companyCnpj: string; companyPhone: string; companyEmailAddr: string; whatsappUrl: string
  pixKey: string; pixBanco: string; horario: string
  companyWebsite: string; portalUrl: string
}

function buildApprovalEmailHtml(d: ApprovalEmailData): string {
  const e = escapeHtml
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">

<!-- Header -->
<tr><td style="background:linear-gradient(135deg,#15803d,#22c55e);padding:36px 32px;text-align:center;">
  <div style="font-size:36px;margin:0 0 8px;">✅</div>
  <h1 style="margin:0 0 4px;color:#fff;font-size:20px;">Aprovacao Confirmada — Orcamento ${e(d.companyName)}</h1>
  <p style="margin:0;color:rgba(255,255,255,.7);font-size:12px;">OS #${e(d.osNum)}</p>
</td></tr>

<!-- Body -->
<tr><td style="padding:32px;">
  <p style="font-size:15px;color:#1e293b;margin:0 0 16px;">Prezado(a) <strong>${e(d.customerFirstName)}</strong>,</p>
  <p style="font-size:14px;color:#475569;line-height:1.7;margin:0 0 24px;">
    Recebemos sua aprovacao e agradecemos pela confianca! Ja demos o sinal verde para nossa equipe tecnica e o reparo do seu equipamento sera iniciado imediatamente.
  </p>

  <!-- Resumo OS -->
  <div style="background:#f8fafc;border:2px solid #e2e8f0;border-radius:10px;padding:16px;margin:0 0 24px;">
    <table width="100%" style="font-size:14px;color:#1e293b;">
      <tr><td style="padding:6px 0;font-weight:700;width:150px;color:#64748b;">Equipamento:</td><td style="padding:6px 0;font-weight:600;">${e(d.equipment)}</td></tr>
      <tr><td style="padding:6px 0;font-weight:700;color:#64748b;">Valor aprovado:</td><td style="padding:6px 0;font-weight:800;font-size:18px;color:#15803d;">${d.fmtValue}</td></tr>
      <tr><td style="padding:6px 0;font-weight:700;color:#64748b;">Previsao entrega:</td><td style="padding:6px 0;font-weight:700;">${d.previsaoStr}</td></tr>
    </table>
  </div>

  <!-- Servico e Prazos -->
  <div style="margin:0 0 24px;">
    <h3 style="margin:0 0 8px;font-size:14px;color:#1e293b;">🛠️ Sobre o Servico e Prazos</h3>
    <ul style="margin:0;padding:0 0 0 20px;font-size:13px;color:#475569;line-height:1.8;">
      <li><strong>Inicio da Contagem:</strong> O prazo comeca a contar a partir de agora.</li>
      <li><strong>Agilidade:</strong> Nosso compromisso e finalizar e entregar o mais rapido possivel.</li>
      <li><strong>Aviso de Conclusao:</strong> Voce recebera uma notificacao assim que o servico for finalizado.</li>
    </ul>
  </div>

  <!-- Pagamento -->
  <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:16px;margin:0 0 24px;">
    <h3 style="margin:0 0 8px;font-size:14px;color:#1e40af;">💳 Formas de Pagamento (na Entrega)</h3>
    <ul style="margin:0;padding:0 0 0 20px;font-size:13px;color:#1e40af;line-height:1.8;">
      <li><strong>Cartao de Credito:</strong> Parcelamos em ate 3x sem juros</li>
      <li><strong>PIX / Transferencia:</strong>${d.pixBanco ? ` ${e(d.pixBanco)} —` : ''} Chave PIX (CNPJ): ${e(d.pixKey)}</li>
      <li>Favorecido: ${e(d.companyName)}</li>
    </ul>
  </div>

  <!-- Entrega -->
  <div style="margin:0 0 24px;">
    <h3 style="margin:0 0 8px;font-size:14px;color:#1e293b;">🚚 Entrega e Horarios</h3>
    <p style="font-size:13px;color:#475569;line-height:1.7;margin:0;">
      Antes de levarmos o equipamento, entraremos em contato para confirmar se havera alguem no local.<br>
      <strong>Horarios:</strong> ${e(d.horario)}
    </p>
  </div>

  <!-- CTA -->
  <div style="text-align:center;margin:0 0 16px;">
    <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td style="background:#25d366;border-radius:8px;">
      <a href="${d.whatsappUrl}" style="display:inline-block;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;">
        💬 Fale conosco pelo WhatsApp
      </a>
    </td></tr></table>
  </div>
</td></tr>

<!-- Acompanhe sua OS -->
<tr><td style="padding:0 32px 24px;">
  <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px;text-align:center;">
    <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#0369a1;">📱 Acompanhe sua OS</p>
    <p style="margin:0 0 12px;font-size:13px;color:#0c4a6e;">Acesse o Portal do Cliente ou consulte pelo nosso site:</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
      <td style="padding:0 6px;"><a href="${d.portalUrl}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">Portal do Cliente</a></td>
      <td style="padding:0 6px;"><a href="${d.companyWebsite + '/#consulta-os'}" style="display:inline-block;padding:10px 20px;background:#0ea5e9;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">Consultar no Site</a></td>
    </tr></table>
    <p style="margin:12px 0 0;font-size:13px;color:#0c4a6e;">Duvidas? Fale com nosso suporte:</p>
    <table cellpadding="0" cellspacing="0" style="margin:8px auto 0;"><tr>
      <td><a href="${d.whatsappUrl || 'https://wa.me/551126263841'}" style="display:inline-block;padding:10px 24px;background:#25d366;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">💬 WhatsApp Suporte</a></td>
    </tr></table>
  </div>
</td></tr>

<!-- Footer -->
<tr><td style="background:#1e293b;padding:24px 32px;text-align:center;">
  <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#fff;">${e(d.companyName)}</p>
  <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">📍 ${e(d.companyAddress)}${d.companyCep ? ` — CEP ${e(d.companyCep)}` : ''}</p>
  <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">📞 ${e(d.companyPhone)} | ✉️ ${e(d.companyEmailAddr)} | CNPJ: ${e(d.companyCnpj)}</p>
  <div style="border-top:1px solid #334155;padding-top:10px;margin-top:10px;">
    <p style="margin:0;font-size:10px;color:#64748b;">⚙️ Esta e uma mensagem automatica. Nao responda diretamente este email.</p>
  </div>
</td></tr>

</table></td></tr></table></body></html>`
}

// ---------------------------------------------------------------------------
// Retention message — sent 5 minutes after quote rejection
// ---------------------------------------------------------------------------

interface RetentionData {
  companyId: string
  osId: string
  osNum: string
  customerName: string
  customerEmail: string | null
  customerPhone: string | null
  equipment: string
  value: string
  companyName: string
  companyPhone: string
  companyAddress: string
  companyCnpj: string
  companyEmail: string
  companyWebsite: string
  whatsappUrl: string
  portalUrl: string
  reason: string
  slug: string
}

async function sendRetentionMessage(d: RetentionData) {
  const firstName = d.customerName.split(' ')[0]
  const e = escapeHtml

  // 1. Retention EMAIL
  if (d.customerEmail) {
    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:32px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <tr><td style="background:linear-gradient(135deg,#f59e0b 0%,#d97706 50%,#b45309 100%);padding:36px 32px;text-align:center;">
    <div style="width:56px;height:56px;background:rgba(255,255,255,0.15);border-radius:14px;margin:0 auto 12px;line-height:56px;font-size:28px;">&#9203;</div>
    <h1 style="margin:0 0 4px;color:#fff;font-size:22px;font-weight:800;">Nao desista ainda!</h1>
    <p style="margin:0;color:rgba(255,255,255,0.8);font-size:13px;">Estamos trabalhando em uma nova proposta</p>
  </td></tr>
  <tr><td style="padding:32px;">
    <p style="font-size:16px;margin:0 0 16px;color:#1e293b;">Ola <strong>${e(firstName)}</strong>,</p>
    <p style="font-size:14px;color:#475569;margin:0 0 20px;line-height:1.7;">
      Recebemos o seu retorno sobre o orcamento da OS <strong>#${d.osNum}</strong> (${e(d.equipment)}).
      Entendemos perfeitamente — sabemos que custos imprevistos pesam.
    </p>
    <p style="font-size:14px;color:#475569;margin:0 0 24px;line-height:1.7;">
      Mas tambem sabemos a importancia de ter seu equipamento rodando 100%, com a garantia e qualidade da ${e(d.companyName)}.
      Por isso, <strong>nao encerramos o seu chamado ainda!</strong>
    </p>

    <div style="background:linear-gradient(135deg,#fef3c7 0%,#fde68a 100%);border:2px solid #f59e0b;border-radius:12px;padding:24px;margin:0 0 24px;">
      <p style="margin:0 0 16px;font-size:15px;font-weight:700;color:#92400e;">Vamos fazer um esforco extra para viabilizar esse reparo:</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:8px 0;vertical-align:top;width:30px;font-size:18px;">&#128200;</td>
          <td style="padding:8px 0 8px 8px;">
            <p style="margin:0 0 2px;font-size:13px;font-weight:700;color:#78350f;">Negociar com Fornecedores</p>
            <p style="margin:0;font-size:12px;color:#92400e;">Vamos buscar condicao diferenciada nas pecas necessarias.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 0;vertical-align:top;width:30px;font-size:18px;">&#129309;</td>
          <td style="padding:8px 0 8px 8px;">
            <p style="margin:0 0 2px;font-size:13px;font-weight:700;color:#78350f;">Revisar a Mao de Obra</p>
            <p style="margin:0;font-size:12px;color:#92400e;">Vamos reavaliar nossa margem mantendo a mesma garantia.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 0;vertical-align:top;width:30px;font-size:18px;">&#128179;</td>
          <td style="padding:8px 0 8px 8px;">
            <p style="margin:0 0 2px;font-size:13px;font-weight:700;color:#78350f;">Facilitar o Pagamento</p>
            <p style="margin:0;font-size:12px;color:#92400e;">Vamos buscar formas de parcelamento para nao apertar seu orcamento.</p>
          </td>
        </tr>
      </table>
    </div>

    <div style="background:#eff6ff;border:2px solid #93c5fd;border-radius:12px;padding:20px;margin:0 0 24px;text-align:center;">
      <p style="margin:0 0 4px;font-size:16px;font-weight:800;color:#1e40af;">Aguarde so mais 24 horas &#128591;</p>
      <p style="margin:0;font-size:13px;color:#3b82f6;">Voltaremos com uma nova proposta que faca sentido para voce.</p>
    </div>

    <p style="font-size:13px;color:#64748b;margin:0 0 24px;line-height:1.6;">
      Qualquer duvida urgente, e so mandar mensagem! Ou acesse o Portal do Cliente:
    </p>

    <div style="text-align:center;margin:0 0 12px;">
      <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>
        <td style="padding:0 6px;"><a href="${d.portalUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:14px 28px;border-radius:8px;">Acessar Portal</a></td>
        <td style="padding:0 6px;"><a href="${d.whatsappUrl}" style="display:inline-block;background:#25d366;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:14px 28px;border-radius:8px;">WhatsApp Suporte</a></td>
      </tr></table>
    </div>
  </td></tr>
  <tr><td style="background:#1e293b;padding:24px 32px;text-align:center;">
    <p style="margin:0 0 4px;font-size:13px;color:#f8fafc;">Um abraco,</p>
    <p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#fff;">Equipe ${e(d.companyName)}</p>
    ${d.companyAddress ? `<p style="margin:0 0 4px;font-size:11px;color:#94a3b8;">${e(d.companyAddress)}</p>` : ''}
    <p style="margin:0;font-size:11px;color:#94a3b8;">${[d.companyCnpj ? 'CNPJ: ' + d.companyCnpj : '', d.companyPhone ? 'Tel: ' + d.companyPhone : '', d.companyEmail].filter(Boolean).join(' | ')}</p>
  </td></tr>
</table>
</td></tr></table></body></html>`

    await sendCompanyEmail(
      d.companyId,
      d.customerEmail,
      `OS #${d.osNum} — Nao desista! Estamos preparando uma nova proposta — ${d.companyName}`,
      html
    ).catch(err => console.error('[Retention] Email failed:', err))
  }

  // 2. Retention WhatsApp
  if (d.customerPhone) {
    const waText = `Ola ${firstName}! 😊\n\nRecebemos seu retorno sobre o orcamento da OS #${d.osNum} (${d.equipment}).\n\nEntendemos perfeitamente. Mas *nao encerramos seu chamado ainda!* Vamos fazer um esforco extra:\n\n📉 *Negociar com fornecedores* — buscar condicao diferenciada\n🤝 *Revisar mao de obra* — reavaliar mantendo a garantia\n💳 *Facilitar pagamento* — buscar parcelamento\n\n*Aguarde so mais 24h* — voltaremos com uma nova proposta! 🙏\n\nAcompanhe pelo portal: ${d.portalUrl}\n\nEquipe ${d.companyName}`
    try {
      const { sendWhatsAppCloud } = await import('@/lib/whatsapp/cloud-api')
      await sendWhatsAppCloud(d.companyId, d.customerPhone, waText)
      console.log(`[Retention] WhatsApp sent for OS #${d.osNum}`)
    } catch (err) {
      console.error('[Retention] WhatsApp failed:', err)
    }
  }

  console.log(`[Retention] Messages sent for OS #${d.osNum} to ${d.customerEmail || d.customerPhone}`)
}
