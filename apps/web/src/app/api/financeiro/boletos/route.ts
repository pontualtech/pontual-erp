import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { getBoletoProvider } from '@/lib/boleto'
import { z } from 'zod'

const generateBoletoSchema = z.object({
  receivable_id: z.string().min(1, 'ID da conta a receber e obrigatorio'),
})

/**
 * GET /api/financeiro/boletos
 * List boletos (receivables that have boleto data)
 */
export async function GET(request: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, Number(searchParams.get('page') || 1))
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || 20)))
    const status = searchParams.get('status')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    const where: any = {
      company_id: user.companyId,
      deleted_at: null,
      boleto_url: { not: null },
    }

    // Filter by boleto status stored in pix_code field as JSON metadata
    // We store boleto metadata in the pix_code field as JSON: { nossoNumero, barcode, digitableLine, pixCode, boletoStatus }
    if (status) {
      if (status === 'PAID') {
        where.status = 'RECEBIDO'
      } else if (status === 'CANCELLED') {
        where.status = 'CANCELADO'
      } else if (status === 'OVERDUE') {
        where.status = 'PENDENTE'
        where.due_date = { lt: new Date() }
      } else if (status === 'REGISTERED') {
        where.status = 'PENDENTE'
        where.due_date = { gte: new Date() }
      }
    }

    if (startDate || endDate) {
      if (!where.due_date) where.due_date = {}
      if (startDate) where.due_date.gte = new Date(startDate)
      if (endDate) where.due_date.lte = new Date(endDate)
    }

    const [boletos, total] = await Promise.all([
      prisma.accountReceivable.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { due_date: 'asc' },
        include: {
          customers: { select: { id: true, legal_name: true, document_number: true } },
        },
      }),
      prisma.accountReceivable.count({ where }),
    ])

    // Parse boleto metadata from pix_code field
    const data = boletos.map(b => {
      let boletoMeta: any = {}
      try {
        if (b.pix_code) boletoMeta = JSON.parse(b.pix_code)
      } catch { /* not JSON, use as-is */ }

      // Determine display status
      let boletoStatus = boletoMeta.boletoStatus || 'REGISTERED'
      if (b.status === 'RECEBIDO') boletoStatus = 'PAID'
      else if (b.status === 'CANCELADO') boletoStatus = 'CANCELLED'
      else if (b.status === 'PENDENTE' && new Date(b.due_date) < new Date(new Date().toDateString())) {
        boletoStatus = 'OVERDUE'
      }

      return {
        id: b.id,
        description: b.description,
        amount: b.total_amount,
        receivedAmount: b.received_amount,
        dueDate: b.due_date,
        status: boletoStatus,
        nossoNumero: boletoMeta.nossoNumero || '',
        barcode: boletoMeta.barcode || '',
        digitableLine: boletoMeta.digitableLine || '',
        boletoUrl: b.boleto_url,
        pixCode: boletoMeta.pixCode || null,
        customerName: b.customers?.legal_name || '',
        customerDocument: b.customers?.document_number || '',
        createdAt: b.created_at,
      }
    })

    // Summary counts
    const [totalRegistered, totalPaid, totalOverdue, totalCancelled] = await Promise.all([
      prisma.accountReceivable.count({
        where: { company_id: user.companyId, deleted_at: null, boleto_url: { not: null }, status: 'PENDENTE', due_date: { gte: new Date(new Date().toDateString()) } },
      }),
      prisma.accountReceivable.count({
        where: { company_id: user.companyId, deleted_at: null, boleto_url: { not: null }, status: 'RECEBIDO' },
      }),
      prisma.accountReceivable.count({
        where: { company_id: user.companyId, deleted_at: null, boleto_url: { not: null }, status: 'PENDENTE', due_date: { lt: new Date(new Date().toDateString()) } },
      }),
      prisma.accountReceivable.count({
        where: { company_id: user.companyId, deleted_at: null, boleto_url: { not: null }, status: 'CANCELADO' },
      }),
    ])

    return NextResponse.json({
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      summary: {
        registered: totalRegistered,
        paid: totalPaid,
        overdue: totalOverdue,
        cancelled: totalCancelled,
      },
    })
  } catch (err) {
    return handleError(err)
  }
}

/**
 * POST /api/financeiro/boletos
 * Generate a boleto for an existing receivable
 */
export async function POST(request: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'create')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await request.json()
    const { receivable_id } = generateBoletoSchema.parse(body)

    // Fetch the receivable with customer data
    const receivable = await prisma.accountReceivable.findFirst({
      where: {
        id: receivable_id,
        company_id: user.companyId,
        deleted_at: null,
      },
      include: {
        customers: true,
      },
    })

    if (!receivable) {
      return NextResponse.json({ error: 'Conta a receber nao encontrada' }, { status: 404 })
    }

    if (receivable.status !== 'PENDENTE') {
      return NextResponse.json({ error: 'Boleto so pode ser gerado para contas pendentes' }, { status: 400 })
    }

    if (receivable.boleto_url) {
      return NextResponse.json({ error: 'Esta conta ja possui um boleto gerado' }, { status: 400 })
    }

    if (!receivable.customers) {
      return NextResponse.json({ error: 'Cliente nao encontrado para esta conta' }, { status: 400 })
    }

    if (!receivable.customers.document_number) {
      return NextResponse.json({ error: 'Cliente nao possui CPF/CNPJ cadastrado' }, { status: 400 })
    }

    // Get the configured boleto provider
    const providerSetting = await prisma.setting.findUnique({
      where: {
        company_id_key: { company_id: user.companyId, key: 'boleto.provider' },
      },
    })

    const providerName = body.provider || providerSetting?.value || 'inter'

    // Buscar credenciais do Inter do certificado fiscal + settings
    let interConfig: any = undefined
    if (providerName === 'inter') {
      const fiscalCfg = await prisma.fiscalConfig.findUnique({ where: { company_id: user.companyId } })
      const settings = (fiscalCfg?.settings || {}) as Record<string, any>
      const interSettings = await prisma.setting.findMany({
        where: { company_id: user.companyId, key: { in: ['inter.client_id', 'inter.client_secret'] } },
      })
      const interMap: Record<string, string> = {}
      interSettings.forEach(s => { interMap[s.key] = s.value })

      const clientId = interMap['inter.client_id'] || process.env.INTER_CLIENT_ID || ''
      const clientSecret = interMap['inter.client_secret'] || process.env.INTER_CLIENT_SECRET || ''

      if (!clientId || !clientSecret) {
        return NextResponse.json({ error: 'Client ID e Client Secret do Banco Inter não configurados. Vá em Financeiro > CNAB > Configuração.' }, { status: 400 })
      }
      if (!settings.certificate_base64) {
        return NextResponse.json({ error: 'Certificado A1 não instalado. Vá em Configurações > Certificado A1.' }, { status: 400 })
      }

      let certPassword = ''
      if (settings.certificate_password) {
        const { decrypt } = await import('@/lib/encryption')
        certPassword = decrypt(settings.certificate_password)
      }

      interConfig = { clientId, clientSecret, pfxBase64: settings.certificate_base64, pfxPassword: certPassword }
    }

    // Buscar credenciais da Stone
    let stoneConfig: any = undefined
    if (providerName === 'stone') {
      const stoneSettings = await prisma.setting.findMany({
        where: { company_id: user.companyId, key: { in: ['stone.api_key', 'stone.account_id'] } },
      })
      const stoneMap: Record<string, string> = {}
      stoneSettings.forEach(s => { stoneMap[s.key] = s.value })

      const apiKey = stoneMap['stone.api_key'] || process.env.STONE_API_KEY || ''
      if (!apiKey) {
        return NextResponse.json({ error: 'API Key da Stone nao configurada. Va em Financeiro > CNAB > Configuracao.' }, { status: 400 })
      }
      stoneConfig = { apiKey, accountId: stoneMap['stone.account_id'] || '' }
    }

    // Buscar credenciais do Itau
    // Itau uses .crt + .key (not .pfx) — stored in Settings as itau.cert_pem and itau.key_pem
    let itauConfig: any = undefined
    if (providerName === 'itau') {
      const itauSettings = await prisma.setting.findMany({
        where: { company_id: user.companyId, key: { startsWith: 'itau.' } },
      })
      const itauMap: Record<string, string> = {}
      itauSettings.forEach(s => { itauMap[s.key] = s.value })

      const clientId = itauMap['itau.client_id'] || process.env.ITAU_CLIENT_ID || ''
      const clientSecret = itauMap['itau.client_secret'] || process.env.ITAU_CLIENT_SECRET || ''

      if (!clientId || !clientSecret) {
        return NextResponse.json({ error: 'Client ID e Client Secret do Itau nao configurados. Va em Configuracoes > Boletos CNAB.' }, { status: 400 })
      }

      const certPem = itauMap['itau.cert_pem'] || process.env.ITAU_CERT_PEM || ''
      const keyPem = itauMap['itau.key_pem'] || process.env.ITAU_KEY_PEM || ''

      if (!certPem || !keyPem) {
        return NextResponse.json({ error: 'Certificado (.crt) e chave privada (.key) do Itau nao configurados. Va em Configuracoes > Boletos CNAB.' }, { status: 400 })
      }

      itauConfig = {
        clientId,
        clientSecret,
        certPem,
        keyPem,
        agencia: itauMap['itau.agencia'] || '0001',
        conta: itauMap['itau.conta'] || '',
        carteira: itauMap['itau.carteira'] || '109',
        codigoBeneficiario: itauMap['itau.codigo_beneficiario'] || '',
        sandbox: itauMap['itau.sandbox'] === 'true',
      }
    }

    const provider = getBoletoProvider(providerName, interConfig || itauConfig || stoneConfig)

    // Generate boleto
    const boletoResult = await provider.generateBoleto({
      amount: receivable.total_amount,
      dueDate: new Date(receivable.due_date).toISOString().split('T')[0],
      customerName: receivable.customers.legal_name,
      customerDocument: receivable.customers.document_number,
      description: receivable.description,
      receivableId: receivable.id,
    })

    if (!boletoResult.success) {
      return NextResponse.json({ error: 'Falha ao gerar boleto no provedor' }, { status: 500 })
    }

    // Store boleto metadata in pix_code field as JSON, and PDF URL in boleto_url
    const boletoMeta = JSON.stringify({
      nossoNumero: boletoResult.nossoNumero,
      barcode: boletoResult.barcode,
      digitableLine: boletoResult.digitableLine,
      pixCode: boletoResult.pixCode || null,
      boletoStatus: 'REGISTERED',
      provider: providerName,
      generatedAt: new Date().toISOString(),
    })

    const updated = await prisma.accountReceivable.update({
      where: { id: receivable.id },
      data: {
        boleto_url: boletoResult.boletoUrl || `boleto://${boletoResult.nossoNumero}`,
        pix_code: boletoMeta,
      },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'boleto.generate',
      entityId: receivable.id,
      newValue: {
        nossoNumero: boletoResult.nossoNumero,
        provider: providerName,
        amount: receivable.total_amount,
      },
    })

    return success({
      id: updated.id,
      nossoNumero: boletoResult.nossoNumero,
      barcode: boletoResult.barcode,
      digitableLine: boletoResult.digitableLine,
      boletoUrl: boletoResult.boletoUrl,
      pixCode: boletoResult.pixCode,
    }, 201)
  } catch (err) {
    return handleError(err)
  }
}
