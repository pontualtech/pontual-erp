import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getServerUser } from '@/lib/auth'

/**
 * GET /api/os/bulk-print?ids=id1,id2&template=os_full
 *
 * Generates a single HTML document with multiple OS printed in sequence,
 * separated by page breaks. Uses the same template system as single OS print.
 */
export async function GET(req: NextRequest) {
  const user = await getServerUser()
  if (!user) return new NextResponse('Nao autenticado', { status: 401 })

  const idsParam = req.nextUrl.searchParams.get('ids')
  const templateType = req.nextUrl.searchParams.get('template') || 'os_full'
  if (!idsParam) return new NextResponse('ids é obrigatório', { status: 400 })

  const ids = idsParam.split(',').filter(Boolean).slice(0, 50) // max 50
  if (ids.length === 0) return new NextResponse('Nenhuma OS informada', { status: 400 })

  const template = await prisma.printTemplate.findFirst({
    where: { company_id: user.companyId, type: templateType, is_active: true },
  })
  if (!template) return new NextResponse(`Template "${templateType}" nao encontrado`, { status: 404 })

  const company = await prisma.company.findUnique({
    where: { id: user.companyId },
    select: { name: true },
  })

  const osList = await prisma.serviceOrder.findMany({
    where: { id: { in: ids }, company_id: user.companyId, deleted_at: null },
    include: {
      customers: true,
      service_order_items: { where: { deleted_at: null }, orderBy: { created_at: 'asc' } },
      user_profiles: { select: { name: true } },
      module_statuses: { select: { name: true, color: true } },
    },
    orderBy: { os_number: 'asc' },
  })

  if (osList.length === 0) return new NextResponse('Nenhuma OS encontrada', { status: 404 })

  const fmt = (v: number) => `R$ ${(v / 100).toFixed(2).replace('.', ',')}`
  const fmtDate = (d: Date | string | null) => d ? new Date(d).toLocaleDateString('pt-BR') : '-'
  const priorityMap: Record<string, string> = { LOW: 'Baixa', MEDIUM: 'Normal', HIGH: 'Alta', URGENT: 'Urgente' }
  const typeMap: Record<string, string> = { BALCAO: 'Balcao', COLETA: 'Coleta', ENTREGA: 'Entrega', CAMPO: 'Campo', REMOTO: 'Remoto' }

  const pages: string[] = []

  for (const os of osList) {
    const itensTabela = os.service_order_items.map(i => `
      <tr>
        <td>${i.item_type === 'SERVICO' ? 'Servico' : 'Peca'}</td>
        <td>${i.description || '-'}</td>
        <td class="text-center">${i.quantity}</td>
        <td class="text-right">${fmt(i.unit_price)}</td>
        <td class="text-right">${fmt(i.total_price)}</td>
      </tr>`).join('')

    const itensSimples = os.service_order_items.map(i => `
      <tr>
        <td>${i.description || '-'}</td>
        <td class="text-right">${fmt(i.total_price)}</td>
      </tr>`).join('')

    const vars: Record<string, string> = {
      company_name: company?.name || 'ERP',
      os_number: String(os.os_number).padStart(4, '0'),
      status: os.module_statuses?.name || '-',
      status_color: os.module_statuses?.color || '#6b7280',
      tipo_os: typeMap[os.os_type || ''] || os.os_type || '-',
      prioridade: priorityMap[os.priority || ''] || os.priority || '-',
      data_abertura: fmtDate(os.created_at),
      previsao_entrega: fmtDate(os.estimated_delivery),
      data_entrega: fmtDate(os.actual_delivery),
      data_impressao: new Date().toLocaleString('pt-BR'),
      tecnico: os.user_profiles?.name || '-',
      cliente_nome: os.customers?.legal_name || '-',
      cliente_documento: os.customers?.document_number || '-',
      cliente_telefone: os.customers?.phone || os.customers?.mobile || '-',
      cliente_email: os.customers?.email || '-',
      cliente_endereco: [os.customers?.address_street, os.customers?.address_number, os.customers?.address_neighborhood].filter(Boolean).join(', ') || '-',
      cliente_cidade: [os.customers?.address_city, os.customers?.address_state].filter(Boolean).join('/') || '-',
      equipamento: os.equipment_type || '-',
      marca: os.equipment_brand || '-',
      modelo: os.equipment_model || '-',
      serie: os.serial_number || '-',
      problema: os.reported_issue || '-',
      diagnostico: os.diagnosis || '-',
      observacoes_recebimento: os.reception_notes || '-',
      observacoes_internas: os.internal_notes || '-',
      forma_pagamento: os.payment_method || '-',
      valor_total: fmt(os.total_cost || 0),
      valor_servicos: fmt(os.total_services || 0),
      valor_pecas: fmt(os.total_parts || 0),
      itens_tabela: itensTabela,
      itens_tabela_simples: itensSimples,
    }

    let pageHtml = template.html_template
    for (const [key, value] of Object.entries(vars)) {
      pageHtml = pageHtml.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
    }

    // Extract body content only (strip <html>, <head>, <body> wrappers)
    const bodyMatch = pageHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i)
    pages.push(bodyMatch ? bodyMatch[1] : pageHtml)
  }

  // Extract <style> from template for reuse
  const styleMatch = template.html_template.match(/<style[^>]*>([\s\S]*?)<\/style>/i)
  const styles = styleMatch ? styleMatch[1] : ''

  const combinedHtml = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>${osList.length} OS - Impressao em Lote</title>
<style>
${styles}
@media print {
  .page-break { page-break-after: always; }
  .page-break:last-child { page-break-after: auto; }
  .no-print { display: none; }
}
.page-break { page-break-after: always; }
.page-break:last-child { page-break-after: auto; }
.print-header { background: #f8f9fa; padding: 8px 16px; font-size: 12px; color: #666; border-bottom: 1px solid #ddd; margin-bottom: 10px; }
</style>
</head><body>
${pages.map((page, i) => `
<div class="page-break">
  <div class="print-header no-print">OS ${i + 1} de ${pages.length}</div>
  ${page}
</div>
`).join('')}
<script>window.onload=function(){window.print()}</script>
</body></html>`

  return new NextResponse(combinedHtml, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
