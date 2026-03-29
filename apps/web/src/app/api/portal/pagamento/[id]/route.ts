import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { createHmac } from 'crypto'

type Params = { params: { id: string } }

function validatePaymentToken(receivableId: string, token: string): boolean {
  const key = process.env.ENCRYPTION_KEY
  if (!key) return false
  const expected = createHmac('sha256', key).update(receivableId).digest('hex').slice(0, 16)
  return token === expected
}

function daysOverdue(dueDate: Date): number {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const due = new Date(dueDate)
  due.setHours(0, 0, 0, 0)
  return Math.max(0, Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)))
}

/**
 * GET - Dados do recebível para a página de pagamento do portal
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')
    const slug = searchParams.get('slug')

    if (!token || !slug) {
      return error('Token e slug são obrigatórios', 400)
    }

    if (!validatePaymentToken(params.id, token)) {
      return error('Token inválido ou expirado', 401)
    }

    const receivable = await prisma.accountReceivable.findFirst({
      where: { id: params.id, deleted_at: null },
      include: {
        customers: true,
        companies: true,
      },
    })

    if (!receivable) return error('Título não encontrado', 404)

    // Verify company slug matches
    if (receivable.companies.slug !== slug) {
      return error('Token inválido', 401)
    }

    // Load company settings
    const settings = await prisma.setting.findMany({
      where: { company_id: receivable.company_id },
    })
    const settingsMap: Record<string, string> = {}
    for (const s of settings) settingsMap[s.key] = s.value

    const pendingAmount = receivable.total_amount - (receivable.received_amount || 0)
    const days = daysOverdue(receivable.due_date)

    return success({
      id: receivable.id,
      description: receivable.description,
      total_amount: receivable.total_amount,
      received_amount: receivable.received_amount || 0,
      pending_amount: pendingAmount,
      due_date: receivable.due_date.toISOString(),
      days_overdue: days,
      status: receivable.status,
      payment_method: receivable.payment_method,
      boleto_url: receivable.boleto_url,
      pix_code: receivable.pix_code,
      customer_name: receivable.customers?.legal_name || '—',
      company: {
        name: receivable.companies.name,
        phone: settingsMap['company.phone'] || settingsMap['telefone'] || null,
        email: settingsMap['company.email'] || settingsMap['email'] || null,
        pix_key: settingsMap['pix.key'] || null,
        bank_info: settingsMap['bank.info'] || null,
        whatsapp: settingsMap['company.whatsapp'] || settingsMap['whatsapp'] || null,
      },
    })
  } catch (err) {
    return handleError(err)
  }
}

/**
 * POST - Marcar como pago (informado pelo cliente)
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const body = await request.json()
    const { token, slug, action } = body as { token?: string; slug?: string; action?: string }

    if (!token || !slug) {
      return error('Token e slug são obrigatórios', 400)
    }

    if (!validatePaymentToken(params.id, token)) {
      return error('Token inválido ou expirado', 401)
    }

    const receivable = await prisma.accountReceivable.findFirst({
      where: { id: params.id, deleted_at: null },
      include: { companies: true, customers: true },
    })

    if (!receivable) return error('Título não encontrado', 404)
    if (receivable.companies.slug !== slug) return error('Token inválido', 401)

    if (action === 'mark_paid') {
      // Não atualiza para RECEBIDO direto — registra a informação para a empresa confirmar
      const today = new Date().toLocaleDateString('pt-BR')
      const currentNotes = receivable.notes || ''
      const newNote = `Cliente informou pagamento em ${today} (via portal)`

      await prisma.accountReceivable.update({
        where: { id: params.id },
        data: {
          notes: currentNotes ? `${currentNotes}\n${newNote}` : newNote,
        },
      })

      logAudit({
        companyId: receivable.company_id,
        userId: 'portal',
        module: 'cobranca',
        action: 'customer_marked_paid',
        entityId: receivable.id,
        newValue: {
          customer_name: receivable.customers?.legal_name,
          amount: receivable.total_amount,
          informed_via: 'portal',
        },
      })

      return success({ marked: true })
    }

    return error('Ação inválida', 400)
  } catch (err) {
    return handleError(err)
  }
}
