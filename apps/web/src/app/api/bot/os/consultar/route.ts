import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { authenticateBot } from '../../_lib/auth'
import { botSuccess, botError } from '../../_lib/response'

const VHSYS_PROXY = 'https://vhsys-proxy.vercel.app'
const VHSYS_SECRET = process.env.VHSYS_PROXY_SECRET || ''
const ERP_CUTOFF_DATE = new Date('2026-04-10T00:00:00Z')

/**
 * GET /api/bot/os/consultar?numero_os=60052
 *
 * Tool do Dify "consultar_dados_os" — busca OS por numero, CPF ou telefone.
 * Detecta automaticamente se e sistema legado (VHSys) ou ERP novo.
 * Multi-tenant: valida company_id via X-Bot-Key.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = authenticateBot(req)
    if (auth instanceof NextResponse) return auth

    const busca = (req.nextUrl.searchParams.get('numero_os') || '').trim()
    if (!busca) return botError('Parametro "numero_os" e obrigatorio')

    const digits = busca.replace(/\D/g, '')

    // ── Detect search type ──
    let os = null
    let cliente = null
    let searchType: 'os_number' | 'document' | 'phone' = 'os_number'

    if (/^\d{1,6}$/.test(digits)) {
      // OS number (1-6 digits)
      searchType = 'os_number'
      os = await findOsByNumber(parseInt(digits, 10), auth.companyId)
    } else if (digits.length === 11 || digits.length === 14) {
      // CPF (11) or CNPJ (14) — find customer, then latest OS
      searchType = 'document'
      cliente = await prisma.customer.findFirst({
        where: { company_id: auth.companyId, document_number: digits, deleted_at: null },
        select: { id: true, legal_name: true, document_number: true, email: true, mobile: true, phone: true },
      })
      if (cliente) {
        const latestOs = await prisma.serviceOrder.findFirst({
          where: { customer_id: cliente.id, company_id: auth.companyId, deleted_at: null },
          orderBy: { created_at: 'desc' },
          include: osInclude,
        })
        if (latestOs) os = latestOs
      }
      // Fallback: CPF 11 digits might be phone number
      if (!cliente && digits.length === 11) {
        searchType = 'phone'
        const result = await findOsByPhone(digits, auth.companyId)
        if (result) { os = result.os; cliente = result.cliente }
      }
    } else if (digits.length >= 10 && digits.length <= 13) {
      // Phone number
      searchType = 'phone'
      const result = await findOsByPhone(digits, auth.companyId)
      if (result) { os = result.os; cliente = result.cliente }
    }

    // ── Not found in ERP — try VHSys for OS numbers ──
    if (!os && searchType === 'os_number' && parseInt(digits, 10) < 60000) {
      const vhsysResult = await searchVHSys(parseInt(digits, 10))
      if (vhsysResult) {
        return botSuccess({
          sucesso: true,
          dados: {
            numero_os: String(vhsysResult.os_number),
            data_abertura: vhsysResult.created_at,
            sistema_legado: true,
            status_atual: vhsysResult.status || 'Desconhecido',
            previsao_entrega: vhsysResult.estimated_delivery || null,
            equipamento: vhsysResult.equipment || 'Equipamento',
            defeito: vhsysResult.reported_issue || null,
            diagnostico: vhsysResult.diagnosis || null,
            tecnico: vhsysResult.technician || null,
            custo_total: vhsysResult.total_cost || null,
            cliente_nome: vhsysResult.customer_name || null,
            cliente_email: vhsysResult.customer_email || null,
            portal_url: null,
            mensagem_triagem: 'Esta OS e do nosso sistema anterior. Vou transferir para o Rafael que cuida pessoalmente.',
          },
        })
      }
    }

    // ── Not found anywhere ──
    if (!os) {
      return botSuccess({
        sucesso: false,
        dados: null,
        mensagem: `Nenhuma OS encontrada para: ${busca}`,
      })
    }

    // ── Build response ──
    const isLegado = os.created_at ? os.created_at < ERP_CUTOFF_DATE : false
    const company = await prisma.company.findUnique({ where: { id: auth.companyId }, select: { slug: true } }).catch(() => null)
    const portalBase = process.env.PORTAL_URL || 'https://portal.pontualtech.com.br'
    const portalSlug = company?.slug || 'pontualtech'
    const portalUrl = `${portalBase}/portal/${portalSlug}/os/${os.id}`

    // Calculate delivery situation
    const now = new Date()
    let situacao_prazo = 'sem_previsao'
    let dias_restantes: number | null = null
    if (os.module_statuses?.is_final) {
      situacao_prazo = 'concluida'
    } else if (os.estimated_delivery) {
      const est = new Date(os.estimated_delivery)
      const diffMs = est.getTime() - now.getTime()
      dias_restantes = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
      situacao_prazo = dias_restantes >= 0 ? 'no_prazo' : 'atrasada'
    }

    // Human-readable status message
    const mensagemStatus = buildStatusMessage(
      os.module_statuses?.name || 'Desconhecido',
      situacao_prazo,
      dias_restantes,
      os.estimated_delivery,
      os.os_number,
    )

    const { toTitleCase } = await import('@/lib/format-text')
    return botSuccess({
      sucesso: true,
      dados: {
        numero_os: String(os.os_number),
        os_id: os.id,
        data_abertura: os.created_at,
        sistema_legado: isLegado,
        status_atual: os.module_statuses?.name ?? 'Desconhecido',
        status_cor: os.module_statuses?.color ?? '#6B7280',
        status_final: os.module_statuses?.is_final ?? false,
        situacao_prazo,
        dias_restantes,
        previsao_entrega: os.estimated_delivery
          ? new Date(os.estimated_delivery).toLocaleDateString('pt-BR')
          : null,
        data_entrega: os.actual_delivery
          ? new Date(os.actual_delivery).toLocaleDateString('pt-BR')
          : null,
        equipamento: [os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).map(s => toTitleCase(s!)).join(' ') || 'Equipamento',
        defeito: os.reported_issue,
        diagnostico: os.diagnosis,
        tecnico: os.user_profiles?.name ?? null,
        custo_estimado: os.estimated_cost,
        custo_total: os.total_cost,
        total_pecas: os.total_parts,
        total_servicos: os.total_services,
        garantia: os.is_warranty ?? false,
        cliente_nome: toTitleCase(os.customers?.legal_name || '') || null,
        cliente_email: os.customers?.email ?? null,
        cliente_telefone: os.customers?.mobile || os.customers?.phone || null,
        portal_url: portalUrl,
        mensagem_status: mensagemStatus,
        ...(isLegado ? { mensagem_triagem: 'Esta OS e do nosso sistema anterior. Vou transferir para o Rafael que cuida pessoalmente.' } : {}),
      },
    })
  } catch (err: any) {
    console.error('[Bot os/consultar]', err.message)
    return botError('Erro interno ao consultar OS', 500)
  }
}

// ── Prisma include for OS queries ──
const osInclude = {
  customers: {
    select: { id: true, legal_name: true, document_number: true, email: true, mobile: true, phone: true },
  },
  module_statuses: { select: { name: true, color: true, is_final: true } },
  user_profiles: { select: { name: true } },
}

// ── Find OS by number (local DB) ──
async function findOsByNumber(num: number, companyId: string) {
  return prisma.serviceOrder.findFirst({
    where: { os_number: num, company_id: companyId, deleted_at: null },
    include: osInclude,
  })
}

// ── Find OS by phone (customer lookup) ──
async function findOsByPhone(digits: string, companyId: string) {
  const phoneSuffix = digits.slice(-10)
  const customer = await prisma.customer.findFirst({
    where: {
      company_id: companyId,
      deleted_at: null,
      OR: [
        { mobile: { contains: phoneSuffix } },
        { phone: { contains: phoneSuffix } },
      ],
    },
    select: { id: true, legal_name: true, document_number: true, email: true, mobile: true, phone: true },
  })
  if (!customer) return null
  const os = await prisma.serviceOrder.findFirst({
    where: { customer_id: customer.id, company_id: companyId, deleted_at: null },
    orderBy: { created_at: 'desc' },
    include: osInclude,
  })
  return os ? { os, cliente: customer } : null
}

// ── Search VHSys via proxy (legacy OS) ──
async function searchVHSys(osNumber: number) {
  if (!VHSYS_SECRET) return null
  try {
    const res = await fetch(`${VHSYS_PROXY}/api/os-buscar?pedido=${osNumber}&_secret=${VHSYS_SECRET}`, {
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null
    const data = await res.json()
    const os = data.data?.[0] || data[0]
    if (!os) return null
    return {
      os_number: os.id_pedido || os.numero || osNumber,
      status: os.status_pedido || os.status || 'Desconhecido',
      equipment: [os.tipo_equipamento, os.marca, os.modelo].filter(Boolean).join(' '),
      reported_issue: os.defeito_relatado || os.obs_pedido,
      diagnosis: os.diagnostico,
      technician: os.nome_tecnico,
      total_cost: os.valor_total ? Math.round(parseFloat(os.valor_total) * 100) : null,
      customer_name: os.nome_cliente,
      customer_email: os.email_cliente,
      estimated_delivery: os.data_previsao,
      created_at: os.data_cad_pedido,
    }
  } catch (err) {
    console.error('[Bot os/consultar] VHSys lookup failed:', err)
    return null
  }
}

// ── Build human-readable status message for the bot ──
function buildStatusMessage(
  status: string,
  situacao: string,
  diasRestantes: number | null,
  previsao: Date | string | null,
  osNum: number,
): string {
  const osStr = `#${String(osNum).padStart(4, '0')}`
  const previsaoStr = previsao
    ? new Date(previsao).toLocaleDateString('pt-BR')
    : null

  switch (situacao) {
    case 'concluida':
      return `Sua OS ${osStr} foi finalizada (${status}). Se precisar de algo mais, estamos a disposicao!`
    case 'no_prazo':
      if (diasRestantes !== null && diasRestantes <= 1) {
        return `Sua OS ${osStr} esta quase pronta! Previsao: ${previsaoStr}. Estamos finalizando para voce.`
      }
      return `Sua OS ${osStr} esta em andamento (${status}). Previsao de entrega: *${previsaoStr}* (${diasRestantes} dias). Estamos trabalhando para adiantar!`
    case 'atrasada':
      if (diasRestantes !== null && diasRestantes >= -3) {
        return `Sua OS ${osStr} esta com prazo em revisao. Estamos finalizando o mais rapido possivel. Nossa equipe entrara em contato com uma atualizacao.`
      }
      return `Pedimos desculpas pelo atraso na OS ${osStr}. Vou verificar com nossa equipe tecnica e retorno com uma posicao.`
    case 'sem_previsao':
      if (status.toLowerCase().includes('orc') || status.toLowerCase().includes('aguardando')) {
        return `Sua OS ${osStr} esta na etapa de ${status}. Assim que tivermos uma definicao, informaremos a previsao.`
      }
      return `Sua OS ${osStr} esta com status: ${status}. Estamos cuidando do seu equipamento!`
    default:
      return `Sua OS ${osStr} esta com status: ${status}.`
  }
}
