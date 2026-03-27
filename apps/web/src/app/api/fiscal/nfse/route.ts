import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, paginated, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { emitirNfse } from '@/lib/nfse/focus-nfe'
import type { NfseInput, PrestadorConfig } from '@/lib/nfse/types'
import { z } from 'zod'

// ---------- GET: List NFS-e invoices ----------

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
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    const where: any = {
      company_id: user.companyId,
      invoice_type: 'NFSE',
    }

    if (status) where.status = status

    if (startDate || endDate) {
      where.issued_at = {}
      if (startDate) where.issued_at.gte = new Date(startDate)
      if (endDate) where.issued_at.lte = new Date(endDate + 'T23:59:59.999Z')
    }

    if (search) {
      where.OR = [
        { customers: { legal_name: { contains: search, mode: 'insensitive' } } },
        { customers: { document_number: { contains: search } } },
        { invoice_number: isNaN(Number(search)) ? undefined : Number(search) },
        { access_key: { contains: search } },
      ].filter(Boolean)
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

// ---------- POST: Emit NFS-e ----------

const emitNfseSchema = z.object({
  customer_id: z.string().min(1, 'Cliente obrigatorio'),
  service_order_id: z.string().optional(),
  descricao_servico: z.string().min(1, 'Descricao do servico obrigatoria'),
  valor_servicos: z.number().int().positive('Valor deve ser positivo'), // centavos
  codigo_servico: z.string().optional(),
  aliquota: z.number().optional(),
  iss_retido: z.boolean().optional().default(false),
})

export async function POST(request: NextRequest) {
  try {
    const result = await requirePermission('fiscal', 'emitir')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await request.json()
    const data = emitNfseSchema.parse(body)

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

    // Validate prestador data
    const cnpjPrestador = settings.cnpj
    const inscricaoMunicipal = settings.inscricaoMunicipal
    const codigoMunicipio = settings.codigoMunicipio || '3550308'

    if (!cnpjPrestador || !inscricaoMunicipal) {
      return error('CNPJ e Inscricao Municipal do prestador devem estar configurados em Fiscal > Configuracoes.', 422)
    }

    // Load customer
    const customer = await prisma.customer.findFirst({
      where: { id: data.customer_id, company_id: user.companyId, deleted_at: null },
    })
    if (!customer) return error('Cliente nao encontrado', 404)

    // Validate customer document
    const customerDoc = customer.document_number
    if (!customerDoc) {
      return error('Cliente nao possui CPF/CNPJ cadastrado', 422)
    }

    // Determine service code and aliquota
    const codigoServico = data.codigo_servico || settings.codigoServicoPadrao || '0107'
    const aliquota = data.aliquota ?? settings.aliquotaPadrao ?? 2.9

    // Convert centavos to reais for Focus NFe
    const valorServicosReais = data.valor_servicos / 100

    // Generate unique ref
    const ref = `nfse-${user.companyId.slice(0, 8)}-${Date.now()}`

    // Build NFS-e input
    const nfseInput: NfseInput = {
      razao_social_tomador: customer.legal_name,
      ...(customerDoc.replace(/\D/g, '').length > 11
        ? { cnpj_tomador: customerDoc.replace(/\D/g, '') }
        : { cpf_tomador: customerDoc.replace(/\D/g, '') }
      ),
      endereco_tomador: {
        logradouro: customer.address_street || '',
        numero: customer.address_number || 'S/N',
        bairro: customer.address_neighborhood || '',
        codigo_municipio: codigoMunicipio,
        uf: customer.address_state || 'SP',
        cep: (customer.address_zip || '').replace(/\D/g, ''),
      },
      servico: {
        discriminacao: data.descricao_servico,
        valor_servicos: valorServicosReais,
        aliquota,
        item_lista_servico: codigoServico,
        iss_retido: data.iss_retido ?? false,
        codigo_municipio: codigoMunicipio,
      },
    }

    const prestador: PrestadorConfig = {
      cnpj: cnpjPrestador.replace(/\D/g, ''),
      inscricao_municipal: inscricaoMunicipal,
      codigo_municipio: codigoMunicipio,
    }

    // Create invoice record first (PROCESSING status)
    const invoice = await prisma.invoice.create({
      data: {
        company_id: user.companyId,
        invoice_type: 'NFSE',
        customer_id: data.customer_id,
        service_order_id: data.service_order_id,
        status: 'PROCESSING',
        provider_name: config.provider || 'focus_nfe',
        provider_ref: ref,
        total_amount: data.valor_servicos,
        tax_amount: Math.round(data.valor_servicos * (aliquota / 100)),
        notes: data.descricao_servico,
        issued_at: new Date(),
        invoice_items: {
          create: [{
            service_code: codigoServico,
            description: data.descricao_servico,
            quantity: 1,
            unit_price: data.valor_servicos,
            total_price: data.valor_servicos,
            taxes: {
              aliquota,
              iss_retido: data.iss_retido ?? false,
              item_lista_servico: codigoServico,
            },
          }],
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
        action: 'nfse.emitir.request',
        request: nfseInput as any,
      },
    }).catch(() => {})

    // Call Focus NFe API
    try {
      const focusResult = await emitirNfse(
        nfseInput,
        ref,
        prestador,
        config.api_key!,
        config.environment || undefined,
      )

      // Log response
      await prisma.fiscalLog.create({
        data: {
          company_id: user.companyId,
          invoice_id: invoice.id,
          action: 'nfse.emitir.response',
          response: (focusResult.raw_response || {}) as any,
          status_code: focusResult.status === 'erro' ? 422 : 200,
        },
      }).catch(() => {})

      if (focusResult.status === 'erro') {
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { status: 'REJECTED' },
        })
        return error(`Erro Focus NFe: ${focusResult.mensagem_erro || 'Erro desconhecido'}`, 422)
      }

      // Update invoice with Focus NFe data
      const updateData: any = {
        provider_ref: focusResult.ref || ref,
      }

      if (focusResult.status === 'autorizada') {
        updateData.status = 'AUTHORIZED'
        updateData.authorized_at = new Date()
        updateData.invoice_number = focusResult.numero_nfse ? Number(focusResult.numero_nfse) : undefined
        updateData.access_key = focusResult.codigo_verificacao
        updateData.xml_url = focusResult.url_xml
        updateData.danfe_url = focusResult.url_pdf || focusResult.url_nfse
      }
      // else stays PROCESSING — will be polled on GET detail

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
        action: 'nfse.emitir',
        entityId: invoice.id,
        newValue: {
          total_amount: data.valor_servicos,
          service_code: codigoServico,
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
          action: 'nfse.emitir.error',
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
