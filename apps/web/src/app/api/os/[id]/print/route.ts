import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getServerUser } from '@/lib/auth'

type RouteParams = { params: { id: string } }

export async function GET(req: NextRequest, { params }: RouteParams) {
  const user = await getServerUser()
  if (!user) return new NextResponse('Nao autenticado', { status: 401 })

  const templateType = req.nextUrl.searchParams.get('template') || 'os_full'

  const os = await prisma.serviceOrder.findFirst({
    where: { id: params.id, company_id: user.companyId },
    include: {
      customers: true,
      service_order_items: { where: { deleted_at: null }, orderBy: { created_at: 'asc' } },
      user_profiles: { select: { name: true } },
      module_statuses: { select: { name: true, color: true } },
    },
  })

  if (!os) return new NextResponse('OS nao encontrada', { status: 404 })

  const company = await prisma.company.findUnique({
    where: { id: user.companyId },
    select: { name: true, slug: true },
  })

  // Load company settings for CNPJ, phone, email, address, etc.
  const companySettings = await prisma.setting.findMany({
    where: { company_id: user.companyId },
  })
  const sm: Record<string, string> = {}
  for (const s of companySettings) sm[s.key] = s.value
  const companyPhone = sm['phone'] || sm['company.phone'] || sm['company.whatsapp'] || '-'
  const companyEmail = sm['email'] || sm['email.from_address'] || sm['company.email'] || '-'
  const companyCnpj = sm['cnpj'] || sm['cnab.cnpj'] || sm['company.cnpj'] || '-'
  const companySlug = company?.slug || 'pontualtech'
  const portalBaseUrl = process.env.PORTAL_URL || 'https://portal.pontualtech.com.br'
  const portalUrl = `${portalBaseUrl}/portal/${companySlug}`
  const whatsappNum = sm['bot.config.support_whatsapp'] || sm['company.whatsapp'] || companyPhone
  const companyAddress = [sm['address_street'] || sm['cnab.endereco'], sm['address_number'] || sm['company.number'], sm['address_complement']].filter(Boolean).join(', ')
    + (sm['address_neighborhood'] || sm['cnab.bairro'] ? ` — ${sm['address_neighborhood'] || sm['cnab.bairro']}` : '')
    + (sm['address_zip'] || sm['cnab.cep'] ? ` — CEP ${sm['address_zip'] || sm['cnab.cep']}` : '')
    + (sm['address_city'] || sm['cnab.cidade'] ? ` — ${sm['address_city'] || sm['cnab.cidade']}` : '')
    + (sm['address_state'] || sm['cnab.uf'] ? `/${sm['address_state'] || sm['cnab.uf']}` : '')
    || '-'

  // Buscar template do banco
  const template = await prisma.printTemplate.findFirst({
    where: { company_id: user.companyId, type: templateType, is_active: true },
  })

  if (!template) {
    return new NextResponse(`Template "${templateType}" nao encontrado`, { status: 404 })
  }

  // Helpers
  const fmt = (v: number) => `R$ ${(v / 100).toFixed(2).replace('.', ',')}`
  const fmtDate = (d: Date | string | null) => d ? new Date(d).toLocaleDateString('pt-BR') : '-'

  // Montar tabela de itens completa
  const itensTabela = os.service_order_items.map(i => `
    <tr>
      <td>${i.item_type === 'SERVICO' ? 'Servico' : 'Peca'}</td>
      <td>${i.description || '-'}</td>
      <td class="text-center">${i.quantity}</td>
      <td class="text-right">${fmt(i.unit_price)}</td>
      <td class="text-right">${fmt(i.total_price)}</td>
    </tr>`).join('')

  // Tabela simplificada (sem unit price)
  const itensSimples = os.service_order_items.map(i => `
    <tr>
      <td>${i.description || '-'}</td>
      <td class="text-right">${fmt(i.total_price)}</td>
    </tr>`).join('')

  const priorityMap: Record<string, string> = { LOW: 'Baixa', MEDIUM: 'Normal', HIGH: 'Alta', URGENT: 'Urgente' }
  const typeMap: Record<string, string> = { BALCAO: 'Balcao', COLETA: 'Coleta', ENTREGA: 'Entrega', CAMPO: 'Campo', REMOTO: 'Remoto' }

  // Substituir todas as variáveis
  const vars: Record<string, string> = {
    company_name: company?.name || '-',
    company_cnpj: companyCnpj,
    company_phone: companyPhone,
    company_email: companyEmail,
    company_address: companyAddress,
    portal_url: portalUrl,
    whatsapp_suporte: whatsappNum,
    whatsapp_link: `https://wa.me/${whatsappNum.replace(/\D/g, '')}`,
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
    // Cliente
    cliente_nome: os.customers?.legal_name || '-',
    cliente_documento: os.customers?.document_number || '-',
    cliente_telefone: os.customers?.phone || os.customers?.mobile || '-',
    cliente_email: os.customers?.email || '-',
    cliente_endereco: [os.customers?.address_street, os.customers?.address_number, os.customers?.address_neighborhood].filter(Boolean).join(', ') || '-',
    cliente_cidade: [os.customers?.address_city, os.customers?.address_state].filter(Boolean).join('/') || '-',
    // Equipamento
    equipamento: os.equipment_type || '-',
    marca: os.equipment_brand || '-',
    modelo: os.equipment_model || '-',
    serie: os.serial_number || '-',
    // Textos
    problema: os.reported_issue || '-',
    diagnostico: os.diagnosis || '-',
    observacoes_recebimento: os.reception_notes || '-',
    observacoes_internas: os.internal_notes || '-',
    forma_pagamento: os.payment_method || '-',
    // Valores
    valor_total: fmt(os.total_cost || 0),
    valor_servicos: fmt(os.total_services || 0),
    valor_pecas: fmt(os.total_parts || 0),
    // Tabelas
    itens_tabela: itensTabela,
    itens_tabela_simples: itensSimples,
  }

  let html = template.html_template
  for (const [key, value] of Object.entries(vars)) {
    html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
  }

  // Adicionar auto-print script
  if (!html.includes('window.print')) {
    html = html.replace('</body>', '<script>window.onload=function(){window.print()}</script></body>')
  }

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
