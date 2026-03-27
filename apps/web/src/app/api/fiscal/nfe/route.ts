import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, paginated, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { emitirNfe } from '@/lib/nfe/focus-nfe'
import { NFE_TIPO_CONFIG } from '@/lib/nfe/types'
import type { NfeInput, NfeItem, EmitenteConfig, NfeTipo } from '@/lib/nfe/types'
import { z } from 'zod'

// ---------- GET: List NF-e invoices ----------

export async function GET(request: NextRequest) {
  try {
    const result = await requirePermission('fiscal', 'read')
    if (result instanceof NextResponse) return result
    const user = result

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, Number(searchParams.get('page') || 1))
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || 20)))
    const status = searchParams.get('status')
    const search = searchParams.get('search')
    const tipo = searchParams.get('tipo') // venda, remessa_conserto, retorno_conserto
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    const where: any = {
      company_id: user.companyId,
      invoice_type: 'NFE',
    }

    if (status) where.status = status

    if (startDate || endDate) {
      where.issued_at = {}
      if (startDate) where.issued_at.gte = new Date(startDate)
      if (endDate) where.issued_at.lte = new Date(endDate + 'T23:59:59.999Z')
    }

    // Filter by NFe tipo (stored in notes as prefix)
    if (tipo) {
      where.notes = { startsWith: `[${tipo}]` }
    }

    if (search) {
      where.OR = [
        { customers: { legal_name: { contains: search, mode: 'insensitive' } } },
        { customers: { document_number: { contains: search } } },
        { access_key: { contains: search } },
        ...(isNaN(Number(search)) ? [] : [{ invoice_number: Number(search) }]),
      ]
    }

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          customers: {
            select: { id: true, legal_name: true, document_number: true },
          },
          _count: { select: { invoice_items: true } },
        },
      }),
      prisma.invoice.count({ where }),
    ])

    return paginated(invoices, total, page, limit)
  } catch (err) {
    return handleError(err)
  }
}

// ---------- POST: Emit NF-e ----------

const nfeItemSchema = z.object({
  product_id: z.string().optional(),
  descricao: z.string().min(1, 'Descricao obrigatoria'),
  quantidade: z.number().positive('Quantidade deve ser positiva'),
  valor_unitario: z.number().int().positive('Valor unitario deve ser positivo (centavos)'),
  cfop: z.number().optional(),
  ncm: z.string().optional(),
  unidade: z.string().optional().default('UN'),
  codigo_produto: z.string().optional(),
})

const emitNfeSchema = z.object({
  tipo: z.enum(['venda', 'remessa_conserto', 'retorno_conserto', 'devolucao']),
  customer_id: z.string().min(1, 'Cliente obrigatorio'),
  items: z.array(nfeItemSchema).min(1, 'Pelo menos um item obrigatorio'),
  notas_referenciadas: z.array(z.string().length(44, 'Chave NF-e deve ter 44 digitos')).optional(),
  informacoes_adicionais: z.string().optional(),
  modalidade_frete: z.number().optional(),
})

export async function POST(request: NextRequest) {
  try {
    const result = await requirePermission('fiscal', 'emitir')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await request.json()
    const data = emitNfeSchema.parse(body)

    // Load fiscal config
    const config = await prisma.fiscalConfig.findUnique({
      where: { company_id: user.companyId },
    })
    if (!config) {
      return error('Configuracao fiscal nao encontrada. Configure em Fiscal > Configuracoes.', 422)
    }
    if (!config.api_key) {
      return error('API Key do Focus NFe nao configurada. Configure em Fiscal > Configuracoes.', 422)
    }

    const settings = (config.settings && typeof config.settings === 'object')
      ? config.settings as Record<string, any>
      : {}

    // Validate emitente data
    const cnpjEmitente = settings.cnpj
    if (!cnpjEmitente) {
      return error('CNPJ do emitente deve estar configurado em Fiscal > Configuracoes.', 422)
    }

    // Load customer
    const customer = await prisma.customer.findFirst({
      where: { id: data.customer_id, company_id: user.companyId, deleted_at: null },
    })
    if (!customer) return error('Cliente nao encontrado', 404)

    const customerDoc = customer.document_number
    if (!customerDoc) {
      return error('Cliente nao possui CPF/CNPJ cadastrado', 422)
    }

    // Validate retorno_conserto requires notas_referenciadas
    if (data.tipo === 'retorno_conserto' && (!data.notas_referenciadas || data.notas_referenciadas.length === 0)) {
      return error('Retorno de conserto exige nota(s) referenciada(s) (chave NF-e original)', 422)
    }

    // Get tipo config defaults
    const tipoConfig = NFE_TIPO_CONFIG[data.tipo as NfeTipo]

    // Build items - load product data if product_id provided
    const productIds = data.items.filter(i => i.product_id).map(i => i.product_id!)
    let productsMap: Record<string, any> = {}
    if (productIds.length > 0) {
      const products = await prisma.product.findMany({
        where: { id: { in: productIds }, company_id: user.companyId },
      })
      productsMap = Object.fromEntries(products.map(p => [p.id, p]))
    }

    // Build NF-e items (values in REAIS for Focus NFe API)
    const nfeItems: NfeItem[] = data.items.map((item, idx) => {
      const product = item.product_id ? productsMap[item.product_id] : null
      const cfop = item.cfop || tipoConfig.cfop
      const ncm = item.ncm || product?.ncm || '84433299' // NCM padrao impressoras
      const codigoProduto = item.codigo_produto || product?.internal_code || product?.barcode || String(idx + 1)
      const unidade = item.unidade || product?.unit || 'UN'
      const valorUnitarioReais = item.valor_unitario / 100 // centavos -> reais
      const valorBrutoReais = (item.valor_unitario * item.quantidade) / 100

      return {
        numero_item: idx + 1,
        codigo_produto: codigoProduto,
        descricao: item.descricao,
        cfop,
        unidade_comercial: unidade,
        quantidade_comercial: item.quantidade,
        valor_unitario_comercial: valorUnitarioReais,
        valor_bruto: valorBrutoReais,
        codigo_ncm: ncm.replace(/\D/g, ''),
        icms_origem: 0, // Nacional
        icms_situacao_tributaria: tipoConfig.icms_situacao_tributaria,
        pis_situacao_tributaria: '07', // Operacao isenta (Simples Nacional)
        cofins_situacao_tributaria: '07', // Operacao isenta (Simples Nacional)
      }
    })

    // Calculate total (centavos)
    const totalAmountCentavos = data.items.reduce(
      (sum, i) => sum + (i.valor_unitario * i.quantidade), 0
    )

    // Generate unique ref
    const ref = `nfe-${user.companyId.slice(0, 8)}-${Date.now()}`

    // Build emitente config
    const emitente: EmitenteConfig = {
      cnpj: cnpjEmitente,
      inscricao_estadual: settings.inscricaoEstadual || '',
      razao_social: settings.razaoSocial || settings.nomeFantasia || '',
      nome_fantasia: settings.nomeFantasia || '',
      logradouro: settings.logradouro || '',
      numero: settings.numero || '',
      complemento: settings.complemento || '',
      bairro: settings.bairro || '',
      codigo_municipio: settings.codigoMunicipio || '3550308',
      municipio: settings.municipio || 'Sao Paulo',
      uf: settings.uf || 'SP',
      cep: settings.cep || '',
      telefone: settings.telefone || '',
      regime_tributario: settings.regimeTributario || 1, // Simples Nacional
    }

    // Build destinatario
    const docClean = customerDoc.replace(/\D/g, '')
    const isJuridica = docClean.length > 11

    // Build informacoes adicionais
    let infoAdicionais = data.informacoes_adicionais || ''
    if (tipoConfig.informacoes_adicionais) {
      infoAdicionais = infoAdicionais
        ? `${tipoConfig.informacoes_adicionais} ${infoAdicionais}`
        : tipoConfig.informacoes_adicionais
    }

    // Build NF-e input
    const nfeInput: NfeInput = {
      natureza_operacao: tipoConfig.natureza_operacao,
      tipo: data.tipo as NfeTipo,
      destinatario: {
        ...(isJuridica ? { cnpj: docClean } : { cpf: docClean }),
        nome: customer.legal_name,
        inscricao_estadual: customer.state_registration || undefined,
        email: customer.email || undefined,
        endereco: {
          logradouro: customer.address_street || '',
          numero: customer.address_number || 'S/N',
          complemento: customer.address_complement || undefined,
          bairro: customer.address_neighborhood || '',
          codigo_municipio: settings.codigoMunicipio || '3550308',
          municipio: customer.address_city || 'Sao Paulo',
          uf: customer.address_state || 'SP',
          cep: (customer.address_zip || '').replace(/\D/g, ''),
        },
      },
      items: nfeItems,
      notas_referenciadas: data.notas_referenciadas,
      informacoes_adicionais: infoAdicionais || undefined,
      modalidade_frete: data.modalidade_frete,
    }

    // Create invoice record first (PROCESSING status)
    const invoice = await prisma.invoice.create({
      data: {
        company_id: user.companyId,
        invoice_type: 'NFE',
        customer_id: data.customer_id,
        status: 'PROCESSING',
        provider_name: config.provider || 'focus_nfe',
        provider_ref: ref,
        total_amount: totalAmountCentavos,
        notes: `[${data.tipo}] ${tipoConfig.natureza_operacao}`,
        issued_at: new Date(),
        invoice_items: {
          create: data.items.map((item, idx) => ({
            product_id: item.product_id || undefined,
            description: item.descricao,
            quantity: item.quantidade,
            unit_price: item.valor_unitario,
            total_price: item.valor_unitario * item.quantidade,
            ncm: item.ncm || productsMap[item.product_id || '']?.ncm || '84433299',
            cfop: String(item.cfop || tipoConfig.cfop),
            cst: String(tipoConfig.icms_situacao_tributaria),
            taxes: {
              icms_origem: 0,
              icms_situacao_tributaria: tipoConfig.icms_situacao_tributaria,
              pis_situacao_tributaria: '07',
              cofins_situacao_tributaria: '07',
            },
          })),
        },
      },
      include: {
        invoice_items: true,
        customers: { select: { id: true, legal_name: true, document_number: true } },
      },
    })

    // Log request to fiscal_logs
    await prisma.fiscalLog.create({
      data: {
        company_id: user.companyId,
        invoice_id: invoice.id,
        action: 'nfe.emitir.request',
        request: nfeInput as any,
      },
    }).catch(() => {})

    // Call Focus NFe API
    try {
      const focusResult = await emitirNfe(
        nfeInput,
        ref,
        emitente,
        config.api_key!,
        config.environment || undefined,
      )

      // Log response
      await prisma.fiscalLog.create({
        data: {
          company_id: user.companyId,
          invoice_id: invoice.id,
          action: 'nfe.emitir.response',
          response: (focusResult.raw_response || {}) as any,
          status_code: focusResult.status === 'erro_autorizacao' ? 422 : 200,
        },
      }).catch(() => {})

      if (focusResult.status === 'erro_autorizacao') {
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { status: 'REJECTED' },
        })
        return error(`Erro Focus NFe: ${focusResult.mensagem_sefaz || 'Erro desconhecido'}`, 422)
      }

      // Update invoice with Focus NFe data
      const updateData: any = {
        provider_ref: focusResult.ref || ref,
      }

      if (focusResult.status === 'autorizado') {
        updateData.status = 'AUTHORIZED'
        updateData.authorized_at = new Date()
        updateData.invoice_number = focusResult.numero ? Number(focusResult.numero) : undefined
        updateData.series = focusResult.serie
        updateData.access_key = focusResult.chave_nfe
        updateData.xml_url = focusResult.url_xml
        updateData.danfe_url = focusResult.url_danfe
      }
      // else stays PROCESSING — will be polled on GET /api/fiscal/nfe/{id}

      const updatedInvoice = await prisma.invoice.update({
        where: { id: invoice.id },
        data: updateData,
        include: {
          invoice_items: true,
          customers: { select: { id: true, legal_name: true, document_number: true } },
        },
      })

      logAudit({
        companyId: user.companyId,
        userId: user.id,
        module: 'fiscal',
        action: 'nfe.emitir',
        entityId: invoice.id,
        newValue: {
          tipo: data.tipo,
          total_amount: totalAmountCentavos,
          item_count: data.items.length,
          customer_id: data.customer_id,
          ref,
          focus_status: focusResult.status,
        },
      })

      return success(updatedInvoice, 201)
    } catch (apiErr: any) {
      // Log error
      await prisma.fiscalLog.create({
        data: {
          company_id: user.companyId,
          invoice_id: invoice.id,
          action: 'nfe.emitir.error',
          response: { error: apiErr.message },
          status_code: 502,
        },
      }).catch(() => {})

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: 'REJECTED' },
      })
      return error(`Falha ao comunicar com Focus NFe: ${apiErr.message}`, 502)
    }
  } catch (err) {
    return handleError(err)
  }
}
