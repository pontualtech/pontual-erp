import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { getBoletoProvider } from '@/lib/boleto'

/**
 * GET /api/financeiro/boletos/[id]
 * Get boleto details for a specific receivable
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const receivable = await prisma.accountReceivable.findFirst({
      where: {
        id: params.id,
        company_id: user.companyId,
        deleted_at: null,
      },
      include: {
        customers: { select: { id: true, legal_name: true, document_number: true, email: true, phone: true } },
        categories: { select: { id: true, name: true } },
        service_orders: { select: { id: true, os_number: true } },
      },
    })

    if (!receivable) {
      return NextResponse.json({ error: 'Boleto nao encontrado' }, { status: 404 })
    }

    if (!receivable.boleto_url) {
      return NextResponse.json({ error: 'Esta conta nao possui boleto gerado' }, { status: 404 })
    }

    // Parse boleto metadata
    let boletoMeta: any = {}
    try {
      if (receivable.pix_code) boletoMeta = JSON.parse(receivable.pix_code)
    } catch { /* not JSON */ }

    // Determine display status
    let boletoStatus = boletoMeta.boletoStatus || 'REGISTERED'
    if (receivable.status === 'RECEBIDO') boletoStatus = 'PAID'
    else if (receivable.status === 'CANCELADO') boletoStatus = 'CANCELLED'
    else if (receivable.status === 'PENDENTE' && new Date(receivable.due_date) < new Date(new Date().toDateString())) {
      boletoStatus = 'OVERDUE'
    }

    return success({
      id: receivable.id,
      description: receivable.description,
      amount: receivable.total_amount,
      receivedAmount: receivable.received_amount,
      dueDate: receivable.due_date,
      status: boletoStatus,
      paymentStatus: receivable.status,
      nossoNumero: boletoMeta.nossoNumero || '',
      barcode: boletoMeta.barcode || '',
      digitableLine: boletoMeta.digitableLine || '',
      boletoUrl: receivable.boleto_url,
      pixCode: boletoMeta.pixCode || null,
      provider: boletoMeta.provider || 'unknown',
      generatedAt: boletoMeta.generatedAt || null,
      customer: receivable.customers,
      category: receivable.categories,
      serviceOrder: receivable.service_orders,
      notes: receivable.notes,
      createdAt: receivable.created_at,
    })
  } catch (err) {
    return handleError(err)
  }
}

/**
 * DELETE /api/financeiro/boletos/[id]
 * Cancel a boleto
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const result = await requirePermission('financeiro', 'create')
    if (result instanceof NextResponse) return result
    const user = result

    const receivable = await prisma.accountReceivable.findFirst({
      where: {
        id: params.id,
        company_id: user.companyId,
        deleted_at: null,
      },
    })

    if (!receivable) {
      return NextResponse.json({ error: 'Boleto nao encontrado' }, { status: 404 })
    }

    if (!receivable.boleto_url) {
      return NextResponse.json({ error: 'Esta conta nao possui boleto gerado' }, { status: 404 })
    }

    if (receivable.status === 'RECEBIDO') {
      return NextResponse.json({ error: 'Nao e possivel cancelar boleto de conta ja recebida' }, { status: 400 })
    }

    if (receivable.status === 'CANCELADO') {
      return NextResponse.json({ error: 'Este boleto ja esta cancelado' }, { status: 400 })
    }

    // Parse metadata to get provider and nossoNumero
    let boletoMeta: any = {}
    try {
      if (receivable.pix_code) boletoMeta = JSON.parse(receivable.pix_code)
    } catch { /* not JSON */ }

    const providerName = boletoMeta.provider || 'inter'
    const nossoNumero = boletoMeta.nossoNumero

    // Try to cancel at the bank
    if (nossoNumero) {
      try {
        const provider = getBoletoProvider(providerName)
        await provider.cancelBoleto(nossoNumero)
      } catch (err) {
        console.error('[BOLETO] Failed to cancel at bank:', err)
        // Continue with local cancellation even if bank API fails
      }
    }

    // Update metadata to reflect cancellation
    boletoMeta.boletoStatus = 'CANCELLED'
    boletoMeta.cancelledAt = new Date().toISOString()

    await prisma.accountReceivable.update({
      where: { id: receivable.id },
      data: {
        pix_code: JSON.stringify(boletoMeta),
        status: 'CANCELADO',
      },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'boleto.cancel',
      entityId: receivable.id,
      oldValue: { nossoNumero, status: 'REGISTERED' },
      newValue: { nossoNumero, status: 'CANCELLED' },
    })

    return success({ message: 'Boleto cancelado com sucesso' })
  } catch (err) {
    return handleError(err)
  }
}
