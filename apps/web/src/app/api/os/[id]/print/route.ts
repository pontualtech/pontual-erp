import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getServerUser } from '@/lib/auth'

type RouteParams = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const user = await getServerUser()
  if (!user) return new NextResponse('Nao autenticado', { status: 401 })

  const os = await prisma.serviceOrder.findFirst({
    where: { id: params.id, company_id: user.companyId },
    include: {
      customers: true,
      service_order_items: { where: { deleted_at: null } },
      user_profiles: { select: { name: true } },
      module_statuses: { select: { name: true, color: true } },
    },
  })

  if (!os) return new NextResponse('OS nao encontrada', { status: 404 })

  const company = await prisma.company.findUnique({
    where: { id: user.companyId },
    select: { name: true },
  })

  const fmt = (v: number) => `R$ ${(v / 100).toFixed(2).replace('.', ',')}`
  const fmtDate = (d: Date | string | null) => d ? new Date(d).toLocaleDateString('pt-BR') : '-'

  const itemsHtml = os.service_order_items.map(i => `
    <tr>
      <td style="padding:6px 8px;border:1px solid #ddd;">${i.item_type === 'SERVICO' ? 'Servico' : 'Peca'}</td>
      <td style="padding:6px 8px;border:1px solid #ddd;">${i.description || '-'}</td>
      <td style="padding:6px 8px;border:1px solid #ddd;text-align:center;">${i.quantity}</td>
      <td style="padding:6px 8px;border:1px solid #ddd;text-align:right;">${fmt(i.unit_price)}</td>
      <td style="padding:6px 8px;border:1px solid #ddd;text-align:right;font-weight:bold;">${fmt(i.total_price)}</td>
    </tr>
  `).join('')

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>OS-${String(os.os_number).padStart(4, '0')}</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 12px; color: #333; margin: 20px; }
    h1 { font-size: 18px; margin-bottom: 4px; }
    h2 { font-size: 14px; color: #555; margin: 16px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; }
    .info-grid dt { color: #888; font-size: 11px; }
    .info-grid dd { margin: 0 0 4px; font-weight: 500; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0; }
    th { background: #f5f5f5; padding: 6px 8px; border: 1px solid #ddd; text-align: left; font-size: 11px; }
    .total-row { font-size: 14px; font-weight: bold; text-align: right; margin-top: 8px; }
    .footer { margin-top: 24px; border-top: 1px solid #ddd; padding-top: 8px; font-size: 10px; color: #888; }
    @media print { body { margin: 10px; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${company?.name || 'ERP'}</h1>
      <p style="color:#888;">Ordem de Servico</p>
    </div>
    <div style="text-align:right;">
      <h1>OS-${String(os.os_number).padStart(4, '0')}</h1>
      <p><span style="background:${os.module_statuses?.color || '#888'};color:white;padding:2px 8px;border-radius:4px;font-size:11px;">${os.module_statuses?.name || '-'}</span></p>
    </div>
  </div>

  <h2>Dados da OS</h2>
  <dl class="info-grid">
    <dt>Data Abertura</dt><dd>${fmtDate(os.created_at)}</dd>
    <dt>Tipo</dt><dd>${os.os_type || '-'}</dd>
    <dt>Previsao</dt><dd>${fmtDate(os.estimated_delivery)}</dd>
    <dt>Tecnico</dt><dd>${os.user_profiles?.name || '-'}</dd>
    <dt>Prioridade</dt><dd>${os.priority || '-'}</dd>
    <dt>Equipamento</dt><dd>${os.equipment_type || '-'}</dd>
    <dt>Marca</dt><dd>${os.equipment_brand || '-'}</dd>
    <dt>Modelo</dt><dd>${os.equipment_model || '-'}</dd>
    <dt>N. Serie</dt><dd>${os.serial_number || '-'}</dd>
  </dl>

  <h2>Cliente</h2>
  <dl class="info-grid">
    <dt>Nome</dt><dd>${os.customers?.legal_name || '-'}</dd>
    <dt>CPF/CNPJ</dt><dd>${os.customers?.document_number || '-'}</dd>
    <dt>Telefone</dt><dd>${os.customers?.phone || os.customers?.mobile || '-'}</dd>
    <dt>Email</dt><dd>${os.customers?.email || '-'}</dd>
    <dt>Endereco</dt><dd>${[os.customers?.address_street, os.customers?.address_number, os.customers?.address_neighborhood].filter(Boolean).join(', ') || '-'}</dd>
    <dt>Cidade/UF</dt><dd>${[os.customers?.address_city, os.customers?.address_state].filter(Boolean).join('/') || '-'}</dd>
  </dl>

  <h2>Problema Relatado</h2>
  <p style="background:#f9f9f9;padding:8px;border-radius:4px;">${os.reported_issue || '-'}</p>

  ${os.diagnosis ? `<h2>Diagnostico</h2><p style="background:#f9f9f9;padding:8px;border-radius:4px;">${os.diagnosis}</p>` : ''}

  ${os.service_order_items.length > 0 ? `
  <h2>Itens / Servicos</h2>
  <table>
    <thead><tr><th>Tipo</th><th>Descricao</th><th style="text-align:center;">Qtd</th><th style="text-align:right;">Unit.</th><th style="text-align:right;">Total</th></tr></thead>
    <tbody>${itemsHtml}</tbody>
  </table>
  ` : ''}

  <div class="total-row">Total: ${fmt(os.total_cost || 0)}</div>

  ${os.internal_notes ? `<h2>Observacoes Internas</h2><p style="background:#fff3cd;padding:8px;border-radius:4px;font-size:11px;">${os.internal_notes}</p>` : ''}

  <div class="footer">
    <p>Impresso em ${new Date().toLocaleString('pt-BR')} | ${company?.name || 'ERP'}</p>
  </div>

  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
