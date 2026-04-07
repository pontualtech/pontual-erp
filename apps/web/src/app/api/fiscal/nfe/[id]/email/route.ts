import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

type Params = { params: { id: string } }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('fiscal', 'create')
    if (result instanceof NextResponse) return result
    const user = result

    const { email } = await req.json()
    if (!email) return error('Email obrigatorio', 400)

    const invoice = await prisma.invoice.findFirst({
      where: { id: params.id, company_id: user.companyId },
      include: { customers: true, invoice_items: true },
    })
    if (!invoice) return error('NF-e nao encontrada', 404)

    // Load company settings
    const settings = await prisma.setting.findMany({ where: { company_id: user.companyId } })
    const cfg: Record<string, string> = {}
    for (const s of settings) cfg[s.key] = s.value

    const companyName = cfg['company_name'] || 'PontualTech'
    const companyPhone = cfg['phone'] || cfg['company.whatsapp'] || '(11) 2626-3841'
    const companyEmail = cfg['email'] || cfg['email.from_address'] || 'contato@pontualtech.com.br'
    const fromName = cfg['email.from_name'] || 'PontualTech'
    const fromAddress = cfg['email.from_address'] || 'contato@pontualtech.com.br'

    const chave = invoice.access_key || ''
    const chaveFormatada = chave.replace(/(\d{4})/g, '$1 ').trim()
    const numero = invoice.invoice_number
    const serie = invoice.series || '1'
    const valor = (invoice.total_amount / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    const data = invoice.issued_at ? new Date(invoice.issued_at).toLocaleDateString('pt-BR') : new Date(invoice.created_at).toLocaleDateString('pt-BR')
    const cliente = invoice.customers?.legal_name || 'Cliente'

    // Items table
    const itemsHtml = (invoice.invoice_items || []).map((item, i) =>
      `<tr style="background:${i % 2 === 0 ? '#fff' : '#f8fafc'}">
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px">${item.description || '-'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:center">${item.quantity}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:right">R$ ${((item.unit_price || 0) / 100).toFixed(2)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:right;font-weight:600">R$ ${((item.total_price || 0) / 100).toFixed(2)}</td>
      </tr>`
    ).join('')

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
  <tr><td style="background:linear-gradient(135deg,#1e40af 0%,#2563eb 100%);padding:32px;text-align:center">
    <h1 style="margin:0 0 6px;color:#fff;font-size:22px;font-weight:800">${companyName}</h1>
    <p style="margin:0;color:rgba(255,255,255,0.7);font-size:12px">Assistencia Tecnica em Informatica</p>
    <div style="display:inline-block;background:rgba(255,255,255,0.2);border-radius:20px;padding:6px 20px;margin-top:12px">
      <p style="margin:0;color:#fff;font-size:14px;font-weight:700">NF-e N. ${numero} | Serie ${serie}</p>
    </div>
  </td></tr>
  <tr><td style="padding:28px 32px 0">
    <p style="margin:0 0 16px;font-size:16px;color:#1e293b">Ola <strong>${cliente}</strong>,</p>
    <p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.6">Segue a Nota Fiscal Eletronica referente ao seu atendimento.</p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:20px">
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#475569">
        <tr><td style="padding:4px 0;font-weight:600;width:140px">Numero / Serie:</td><td style="padding:4px 0">${numero} / ${serie}</td></tr>
        <tr><td style="padding:4px 0;font-weight:600">Data Emissao:</td><td style="padding:4px 0">${data}</td></tr>
        <tr><td style="padding:4px 0;font-weight:600">Valor Total:</td><td style="padding:4px 0;font-weight:700;color:#1e293b">${valor}</td></tr>
        <tr><td style="padding:4px 0;font-weight:600">Status:</td><td style="padding:4px 0"><span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600">${invoice.status === 'AUTHORIZED' ? 'Autorizada' : invoice.status}</span></td></tr>
      </table>
    </div>
    ${itemsHtml ? `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
      <tr style="background:#2563eb"><td style="padding:10px 12px;color:#fff;font-weight:700;font-size:13px" colspan="4">Itens da Nota</td></tr>
      <tr style="background:#f1f5f9"><td style="padding:8px 12px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">Descricao</td><td style="padding:8px 12px;font-size:11px;font-weight:700;color:#64748b;text-align:center;text-transform:uppercase">Qtd</td><td style="padding:8px 12px;font-size:11px;font-weight:700;color:#64748b;text-align:right;text-transform:uppercase">Unit.</td><td style="padding:8px 12px;font-size:11px;font-weight:700;color:#64748b;text-align:right;text-transform:uppercase">Total</td></tr>
      ${itemsHtml}
    </table>` : ''}
    <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:14px 16px;margin-bottom:20px">
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#0369a1;text-transform:uppercase">Chave de Acesso</p>
      <p style="margin:0;font-size:12px;color:#0c4a6e;font-family:monospace;letter-spacing:1px;word-break:break-all">${chaveFormatada}</p>
    </div>
    <div style="text-align:center;margin-bottom:20px">
      <a href="https://www.nfe.fazenda.gov.br/portal/consultaRecibo.aspx" target="_blank" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 32px;border-radius:8px">Consultar NF-e na SEFAZ</a>
    </div>
    <div style="text-align:center;margin-bottom:28px">
      <a href="https://wa.me/551126263841" target="_blank" style="display:inline-block;background:#25d366;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 24px;border-radius:6px">WhatsApp Suporte: ${companyPhone}</a>
    </div>
  </td></tr>
  <tr><td style="background:#1e293b;padding:24px 32px;text-align:center">
    <p style="margin:0 0 4px;color:#fff;font-size:14px;font-weight:700">${companyName}</p>
    <p style="margin:0 0 2px;color:#94a3b8;font-size:11px">Rua Ouvidor Peleja, 660 - Vila Mariana - Sao Paulo/SP - CEP 04128-001</p>
    <p style="margin:0 0 2px;color:#94a3b8;font-size:11px">CNPJ: 32.772.178/0001-47 | Tel: ${companyPhone}</p>
    <p style="margin:0;color:#94a3b8;font-size:11px">${companyEmail}</p>
  </td></tr>
</table>
</td></tr></table></body></html>`

    // Send via Resend
    const resendKey = process.env.RESEND_API_KEY
    if (!resendKey) return error('RESEND_API_KEY nao configurada', 500)

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `${fromName} <${fromAddress}>`,
        to: [email],
        subject: `NF-e ${numero} Serie ${serie} - ${companyName}`,
        html,
      }),
    })

    const resendData = await resendRes.json()
    if (!resendRes.ok) {
      console.error('[NF-e Email] Resend error:', resendData)
      return error(`Erro ao enviar: ${resendData.message || 'Falha no envio'}`, 500)
    }

    return success({ sent: true, email, resend_id: resendData.id })
  } catch (err) {
    return handleError(err)
  }
}
