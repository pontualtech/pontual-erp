import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireDriver } from '@/lib/driver-auth'

/**
 * GET /api/driver/os/lookup?number=12345
 * GET /api/driver/os/lookup?doc=12345678900
 *
 * Busca OS pra coleta/entrega avulsa do motorista. Retorna:
 *   - items: lista de OS candidatas (1+) com dados basicos do cliente
 *   - Por numero: 1 match exato
 *   - Por CPF/CNPJ: ate 20 OS ativas (nao deleted, nao Entregue Reparado)
 *
 * Multi-tenant: so devolve OS da empresa do motorista autenticado.
 */
export async function GET(req: NextRequest) {
  const auth = await requireDriver()
  if (auth instanceof NextResponse) return auth

  const url = req.nextUrl.searchParams
  const number = url.get('number')
  const doc = (url.get('doc') || '').replace(/\D/g, '')

  if (!number && !doc) {
    return NextResponse.json({ error: 'Informe number ou doc' }, { status: 400 })
  }

  const baseWhere: any = {
    company_id: auth.companyId,
    deleted_at: null,
    os_location: 'EXTERNO', // rota avulsa tambem so pra OS externa
  }

  let orders: any[] = []
  if (number) {
    const n = parseInt(number, 10)
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: 'Numero invalido' }, { status: 400 })
    }
    orders = await prisma.serviceOrder.findMany({
      where: { ...baseWhere, os_number: n },
      take: 5,
      include: {
        module_statuses: { select: { name: true } },
        customers: {
          select: {
            id: true, legal_name: true, trade_name: true,
            document_number: true, mobile: true, phone: true,
            address_street: true, address_number: true, address_neighborhood: true,
            address_city: true, address_state: true, address_zip: true,
            address_lat: true, address_lng: true,
          },
        },
      },
    })
  } else {
    // Por CPF/CNPJ: acha cliente(s), lista OSes ativas
    const customers = await prisma.customer.findMany({
      where: { company_id: auth.companyId, document_number: doc },
      take: 5,
      select: { id: true },
    })
    const customerIds = customers.map(c => c.id)
    if (customerIds.length === 0) {
      return NextResponse.json({ data: { items: [], reason: 'documento_nao_encontrado' } })
    }
    orders = await prisma.serviceOrder.findMany({
      where: {
        ...baseWhere,
        customer_id: { in: customerIds },
      },
      orderBy: { created_at: 'desc' },
      take: 20,
      include: {
        module_statuses: { select: { name: true } },
        customers: {
          select: {
            id: true, legal_name: true, trade_name: true,
            document_number: true, mobile: true, phone: true,
            address_street: true, address_number: true, address_neighborhood: true,
            address_city: true, address_state: true, address_zip: true,
            address_lat: true, address_lng: true,
          },
        },
      },
    })
  }

  const items = orders.map(os => {
    const c = os.customers
    const addr = c ? [
      c.address_street,
      c.address_number ? `${c.address_number}` : null,
      c.address_neighborhood,
      c.address_city && c.address_state ? `${c.address_city}/${c.address_state}` : null,
      c.address_zip,
    ].filter(Boolean).join(', ') : ''
    return {
      os_id: os.id,
      os_number: os.os_number,
      status: os.module_statuses?.name || '',
      equipment: [os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' '),
      customer: c ? {
        id: c.id,
        name: c.trade_name || c.legal_name,
        doc: c.document_number,
        phone: c.mobile || c.phone,
        address: addr,
        lat: c.address_lat ? Number(c.address_lat) : null,
        lng: c.address_lng ? Number(c.address_lng) : null,
      } : null,
    }
  })

  return NextResponse.json({ data: { items } })
}
