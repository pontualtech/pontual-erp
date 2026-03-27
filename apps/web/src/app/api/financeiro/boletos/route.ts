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
    const result = await requirePermission('financeiro', 'read')
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

    const providerName = providerSetting?.value || 'inter'
    const provider = getBoletoProvider(providerName)

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
