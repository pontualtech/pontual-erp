import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

/**
 * GET /api/logistics/os/lookup?number=12345
 * GET /api/logistics/os/lookup?doc=12345678900
 *
 * Igual ao /api/driver/os/lookup mas com auth de atendente (os:view).
 * Usado pelo modal 'Adicionar Parada' em /logistica/[id] pra autofill
 * de nome, telefone, endereco ao digitar OS ou CPF/CNPJ.
 *
 * Filtra os_location=EXTERNO por padrao (coerente com rota).
 * Query ?include_all_locations=1 sobrescreve em casos especiais.
 */
export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('os', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const url = req.nextUrl.searchParams
    const number = url.get('number')
    const doc = (url.get('doc') || '').replace(/\D/g, '')
    const includeAll = url.get('include_all_locations') === '1'

    if (!number && !doc) return error('Informe number ou doc', 400)

    const baseWhere: any = {
      company_id: user.companyId,
      deleted_at: null,
      ...(includeAll ? {} : { os_location: 'EXTERNO' }),
    }

    let orders: any[] = []
    if (number) {
      const n = parseInt(number, 10)
      if (!Number.isFinite(n) || n <= 0) return error('Numero invalido', 400)
      orders = await prisma.serviceOrder.findMany({
        where: { ...baseWhere, os_number: n },
        take: 5,
        include: {
          module_statuses: { select: { name: true } },
          customers: {
            select: {
              id: true, legal_name: true, trade_name: true,
              document_number: true, mobile: true, phone: true,
              address_street: true, address_complement: true, address_number: true,
              address_neighborhood: true, address_city: true, address_state: true, address_zip: true,
              address_lat: true, address_lng: true,
            },
          },
        },
      })
    } else {
      const customers = await prisma.customer.findMany({
        where: { company_id: user.companyId, document_number: doc },
        take: 5,
        select: { id: true },
      })
      const customerIds = customers.map(c => c.id)
      if (customerIds.length === 0) return success({ items: [], reason: 'documento_nao_encontrado' })
      orders = await prisma.serviceOrder.findMany({
        where: { ...baseWhere, customer_id: { in: customerIds } },
        orderBy: { created_at: 'desc' },
        take: 20,
        include: {
          module_statuses: { select: { name: true } },
          customers: {
            select: {
              id: true, legal_name: true, trade_name: true,
              document_number: true, mobile: true, phone: true,
              address_street: true, address_complement: true, address_number: true,
              address_neighborhood: true, address_city: true, address_state: true, address_zip: true,
              address_lat: true, address_lng: true,
            },
          },
        },
      })
    }

    const items = orders.map(os => {
      const c = os.customers
      const fullAddress = c
        ? [
            c.address_street,
            c.address_number ? `n° ${c.address_number}` : null,
            c.address_complement,
            c.address_neighborhood,
            c.address_city && c.address_state ? `${c.address_city}/${c.address_state}` : c.address_city,
            c.address_zip,
          ].filter(Boolean).join(', ')
        : ''
      const statusName = os.module_statuses?.name || ''
      const isColeta = /colet/i.test(statusName)
      return {
        os_id: os.id,
        os_number: os.os_number,
        os_location: os.os_location || null,
        status: statusName,
        suggested_type: isColeta ? 'COLETA' : 'ENTREGA',
        customer_id: c?.id || null,
        customer_name: c?.trade_name || c?.legal_name || '',
        customer_phone: c?.mobile || c?.phone || '',
        address: fullAddress,
        address_complement: c?.address_complement || '',
        equipment: [os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' '),
        lat: c?.address_lat ? Number(c.address_lat) : null,
        lng: c?.address_lng ? Number(c.address_lng) : null,
      }
    })

    return success({ items, total: items.length })
  } catch (err) {
    return handleError(err)
  }
}
