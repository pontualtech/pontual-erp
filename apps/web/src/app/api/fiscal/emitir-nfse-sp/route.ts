import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { decrypt } from '@/lib/encryption'
import { z } from 'zod'

const emitirSchema = z.object({
  customer_id: z.string(),
  service_order_id: z.string().optional(),
  description: z.string().min(1, 'Discriminação do serviço é obrigatória'),
  service_code: z.string().min(1, 'Código do serviço é obrigatório'),
  total_amount: z.number().min(1, 'Valor deve ser maior que zero'), // em centavos
  aliquota_iss: z.number().optional(), // ex: 0.05
  iss_retido: z.boolean().optional(),
  notes: z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
  const auth = await requirePermission('fiscal', 'manage')
  if (auth instanceof NextResponse) return auth
  const user = auth

  const body = await req.json()
  const parsed = emitirSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 })
  }

  const { customer_id, service_order_id, description, service_code, total_amount, aliquota_iss, iss_retido, notes } = parsed.data

  // 1. Buscar config fiscal
  const config = await prisma.fiscalConfig.findUnique({
    where: { company_id: user.companyId },
  })

  if (!config) {
    return NextResponse.json({ error: 'Configure o módulo fiscal antes de emitir NFS-e' }, { status: 400 })
  }

  const settings = (config.settings || {}) as Record<string, any>

  // Verificar certificado
  if (!settings.certificate_base64) {
    return NextResponse.json({ error: 'Certificado A1 não instalado. Vá em Configurações > Certificado A1' }, { status: 400 })
  }

  if (!settings.cnpj || !settings.inscricaoMunicipal) {
    return NextResponse.json({ error: 'CNPJ e Inscrição Municipal são obrigatórios na configuração fiscal' }, { status: 400 })
  }

  const certPassword = settings.certificate_password ? decrypt(settings.certificate_password) : ''

  // 2. Buscar cliente
  const customer = await prisma.customer.findUnique({ where: { id: customer_id } })
  if (!customer) {
    return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 })
  }

  // 3. Calcular próximo número de RPS
  const lastInvoice = await prisma.invoice.findFirst({
    where: { company_id: user.companyId, invoice_type: 'NFSE', provider_name: 'prefeitura_sp' },
    orderBy: { created_at: 'desc' },
  })
  const nextRPS = lastInvoice ? (parseInt(lastInvoice.series || '0') || 0) + 1 : 1

  // 4. Criar registro da Invoice (status PROCESSING)
  const valorReais = total_amount / 100
  const ref = `SP-${Date.now()}`

  const invoice = await prisma.invoice.create({
    data: {
      company_id: user.companyId,
      invoice_type: 'NFSE',
      series: String(nextRPS),
      customer_id,
      service_order_id: service_order_id || null,
      status: 'PROCESSING',
      provider_ref: ref,
      provider_name: 'prefeitura_sp',
      total_amount: total_amount,
      tax_amount: Math.round(total_amount * (aliquota_iss || 0.05)),
      notes: notes || null,
      invoice_items: {
        create: {
          service_code,
          description,
          quantity: 1,
          unit_price: total_amount,
          total_price: total_amount,
        },
      },
    },
  })

  // 5. Emitir via Prefeitura SP
  const { emitirNfseSP } = await import('@/lib/nfse/prefeitura-sp')
  const spConfig = {
    environment: (config.environment as 'homologacao' | 'producao') || 'homologacao',
    cnpj: settings.cnpj,
    inscricaoMunicipal: settings.inscricaoMunicipal,
    certificateBase64: settings.certificate_base64,
    certificatePassword: certPassword,
  }

  const resultado = await emitirNfseSP(
    {
      numero_rps: nextRPS,
      valor_servicos: valorReais,
      valor_deducoes: 0,
      codigo_servico: service_code,
      aliquota_iss: aliquota_iss || parseFloat(settings.aliquotaISS || '0.05'),
      iss_retido: iss_retido || false,
      discriminacao: description,
      tomador_cpf_cnpj: customer.document_number || '',
      tomador_razao_social: customer.legal_name,
      tomador_email: customer.email || undefined,
      tomador_logradouro: customer.address_street || undefined,
      tomador_numero: customer.address_number || undefined,
      tomador_bairro: customer.address_neighborhood || undefined,
      tomador_cidade: settings.codigoMunicipio || '3550308',
      tomador_uf: customer.address_state || 'SP',
      tomador_cep: customer.address_zip || undefined,
    },
    {
      cnpj: settings.cnpj,
      inscricao_municipal: settings.inscricaoMunicipal,
      codigo_municipio: settings.codigoMunicipio || '3550308',
    },
    spConfig
  )

  // 6. Registrar log
  await prisma.fiscalLog.create({
    data: {
      company_id: user.companyId,
      invoice_id: invoice.id,
      action: 'emitir_nfse_sp',
      request: { input: parsed.data, rps: nextRPS } as any,
      response: {
        sucesso: resultado.sucesso,
        status: resultado.status,
        numero_nfse: resultado.numero_nfse,
        erros: resultado.erros,
      } as any,
      status_code: resultado.sucesso ? 200 : 400,
    },
  })

  // 7. Atualizar invoice com resultado
  if (resultado.sucesso) {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: 'AUTHORIZED',
        invoice_number: resultado.numero_nfse ? parseInt(resultado.numero_nfse) : null,
        access_key: resultado.codigo_verificacao,
        danfe_url: resultado.link_nfse,
        issued_at: new Date(),
        authorized_at: new Date(),
      },
    })
  } else {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: 'REJECTED',
        notes: resultado.erros?.map(e => `[${e.codigo}] ${e.mensagem}`).join('; '),
      },
    })
  }

  return NextResponse.json({
    success: resultado.sucesso,
    invoice_id: invoice.id,
    numero_nfse: resultado.numero_nfse,
    codigo_verificacao: resultado.codigo_verificacao,
    link_nfse: resultado.link_nfse,
    status: resultado.sucesso ? 'AUTHORIZED' : 'REJECTED',
    erros: resultado.erros,
  })
  } catch (e: any) {
    console.error('ERRO emitir-nfse-sp:', e)
    return NextResponse.json({ success: false, error: e.message || 'Erro interno ao emitir NFS-e' }, { status: 500 })
  }
}
