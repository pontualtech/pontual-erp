import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { createHmac } from 'crypto'

type Params = { params: { id: string } }

function validateOrcamentoToken(osId: string, token: string): boolean {
  const key = process.env.ENCRYPTION_KEY
  if (!key) return false
  const expected = createHmac('sha256', key).update('orcamento:' + osId).digest('hex').slice(0, 16)
  return token === expected
}

function fmtCents(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

/**
 * GET - Dados da OS para a página de aprovação de orçamento
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')
    const slug = searchParams.get('slug')

    if (!token || !slug) {
      return error('Token e slug são obrigatórios', 400)
    }

    if (!validateOrcamentoToken(params.id, token)) {
      return error('Token inválido ou expirado', 401)
    }

    const os = await prisma.serviceOrder.findFirst({
      where: { id: params.id, deleted_at: null },
      include: {
        customers: true,
        companies: true,
        module_statuses: true,
        service_order_items: { where: { deleted_at: null } },
      },
    })

    if (!os) return error('Ordem de serviço não encontrada', 404)

    if (os.companies.slug !== slug) {
      return error('Token inválido', 401)
    }

    // Load company settings
    const settings = await prisma.setting.findMany({
      where: { company_id: os.company_id },
    })
    const settingsMap: Record<string, string> = {}
    for (const s of settings) settingsMap[s.key] = s.value

    const items = os.service_order_items.map(item => ({
      id: item.id,
      description: item.description,
      item_type: item.item_type,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: item.total_price,
    }))

    return success({
      id: os.id,
      os_number: os.os_number,
      equipment_type: os.equipment_type,
      equipment_brand: os.equipment_brand,
      equipment_model: os.equipment_model,
      serial_number: os.serial_number,
      reported_issue: os.reported_issue,
      diagnosis: os.diagnosis,
      total_cost: os.total_cost || 0,
      total_parts: os.total_parts || 0,
      total_services: os.total_services || 0,
      status: os.module_statuses?.name || '—',
      items,
      customer_name: os.customers?.legal_name || '—',
      company: {
        name: os.companies.name,
        phone: settingsMap['company.phone'] || settingsMap['telefone'] || null,
        email: settingsMap['company.email'] || settingsMap['email'] || null,
        whatsapp: settingsMap['company.whatsapp'] || settingsMap['whatsapp'] || null,
      },
    })
  } catch (err) {
    return handleError(err)
  }
}

/**
 * POST - Aprovar ou recusar orçamento
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const body = await request.json()
    const { token, slug, action, reason } = body as {
      token?: string
      slug?: string
      action?: 'approve' | 'reject'
      reason?: string
    }

    if (!token || !slug) {
      return error('Token e slug são obrigatórios', 400)
    }

    if (!validateOrcamentoToken(params.id, token)) {
      return error('Token inválido ou expirado', 401)
    }

    if (!action || !['approve', 'reject'].includes(action)) {
      return error('Ação inválida. Use "approve" ou "reject"', 400)
    }

    const os = await prisma.serviceOrder.findFirst({
      where: { id: params.id, deleted_at: null },
      include: {
        companies: true,
        customers: true,
        module_statuses: true,
      },
    })

    if (!os) return error('Ordem de serviço não encontrada', 404)
    if (os.companies.slug !== slug) return error('Token inválido', 401)

    if (action === 'approve') {
      // Find "Aprovado" status
      const approvedStatus = await prisma.moduleStatus.findFirst({
        where: {
          company_id: os.company_id,
          module: 'os',
          name: { contains: 'Aprovad', mode: 'insensitive' },
        },
      })

      if (!approvedStatus) {
        return error('Status "Aprovado" não configurado. Entre em contato com a empresa.', 400)
      }

      // Transition OS
      await prisma.serviceOrder.update({
        where: { id: os.id },
        data: {
          status_id: approvedStatus.id,
          approved_cost: os.total_cost || 0,
          updated_at: new Date(),
        },
      })

      // Create history entry
      await prisma.serviceOrderHistory.create({
        data: {
          company_id: os.company_id,
          service_order_id: os.id,
          from_status_id: os.status_id,
          to_status_id: approvedStatus.id,
          changed_by: 'portal',
          notes: 'Orçamento aprovado pelo cliente via portal',
        },
      })

      logAudit({
        companyId: os.company_id,
        userId: 'portal',
        module: 'os',
        action: 'quote_approved_by_customer',
        entityId: os.id,
        newValue: {
          customer_name: os.customers?.legal_name,
          os_number: os.os_number,
          total_cost: os.total_cost,
          approved_via: 'portal',
        },
      })

      return success({ action: 'approved', message: 'Orçamento aprovado com sucesso!' })
    }

    if (action === 'reject') {
      // Find "Cancelada" or similar status
      const cancelledStatus = await prisma.moduleStatus.findFirst({
        where: {
          company_id: os.company_id,
          module: 'os',
          OR: [
            { name: { contains: 'Cancelad', mode: 'insensitive' } },
            { name: { contains: 'Recusad', mode: 'insensitive' } },
          ],
        },
      })

      // Add rejection notes regardless
      const today = new Date().toLocaleDateString('pt-BR')
      const currentNotes = os.internal_notes || ''
      const rejectionNote = `Orçamento recusado pelo cliente em ${today} (via portal)${reason ? ': ' + reason : ''}`

      const updateData: any = {
        internal_notes: currentNotes ? `${currentNotes}\n${rejectionNote}` : rejectionNote,
        updated_at: new Date(),
      }

      if (cancelledStatus) {
        updateData.status_id = cancelledStatus.id
      }

      await prisma.serviceOrder.update({
        where: { id: os.id },
        data: updateData,
      })

      // Create history entry if status changed
      if (cancelledStatus) {
        await prisma.serviceOrderHistory.create({
          data: {
            company_id: os.company_id,
            service_order_id: os.id,
            from_status_id: os.status_id,
            to_status_id: cancelledStatus.id,
            changed_by: 'portal',
            notes: rejectionNote,
          },
        })
      }

      logAudit({
        companyId: os.company_id,
        userId: 'portal',
        module: 'os',
        action: 'quote_rejected_by_customer',
        entityId: os.id,
        newValue: {
          customer_name: os.customers?.legal_name,
          os_number: os.os_number,
          total_cost: os.total_cost,
          reason: reason || null,
          rejected_via: 'portal',
        },
      })

      return success({ action: 'rejected', message: 'Orçamento recusado. A empresa foi notificada.' })
    }

    return error('Ação inválida', 400)
  } catch (err) {
    return handleError(err)
  }
}
