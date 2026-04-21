import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'

/**
 * POST /api/logistics/lookup-os
 *
 * Faz bulk lookup de OS pra montar paradas de rota automaticamente.
 * Aceita 2 modos (pode combinar):
 *   - numbers: Array<number>  — lista de OS numbers (colar e extrair regex)
 *   - statuses: Array<string> — nomes de status (ex: ['Coletar', 'Entregar Reparado'])
 *
 * Retorna cada OS com: numero, cliente, endereco formatado, equipamento,
 * tipo sugerido (COLETA/ENTREGA baseado no status) e o status atual.
 *
 * NAO altera nada — endpoint read-only usado pela UI de "Nova Rota".
 */
export async function POST(req: NextRequest) {
  const auth = await requirePermission('os', 'view')
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => ({}))
  const numbers: number[] = Array.isArray(body.numbers)
    ? body.numbers.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0)
    : []
  const statuses: string[] = Array.isArray(body.statuses)
    ? body.statuses.filter((s: any) => typeof s === 'string' && s.trim())
    : []

  if (numbers.length === 0 && statuses.length === 0) {
    return NextResponse.json({ error: 'Informe numbers[] ou statuses[]' }, { status: 400 })
  }

  // Resolve statuses into module_status IDs (names podem variar entre empresas)
  const statusFilter: string[] = []
  if (statuses.length > 0) {
    const moduleStatuses = await prisma.moduleStatus.findMany({
      where: {
        company_id: auth.companyId,
        module: 'os',
        OR: statuses.map(s => ({ name: { contains: s, mode: 'insensitive' as const } })),
      },
      select: { id: true, name: true },
    })
    moduleStatuses.forEach(s => statusFilter.push(s.id))
  }

  const where: any = {
    company_id: auth.companyId,
    deleted_at: null,
  }
  const orClauses: any[] = []
  if (numbers.length > 0) orClauses.push({ os_number: { in: numbers } })
  if (statusFilter.length > 0) orClauses.push({ status_id: { in: statusFilter } })
  if (orClauses.length === 1) Object.assign(where, orClauses[0])
  else where.OR = orClauses

  const orders = await prisma.serviceOrder.findMany({
    where,
    include: {
      module_statuses: { select: { name: true } },
      customers: {
        select: {
          id: true, legal_name: true, trade_name: true,
          address_street: true, address_complement: true, address_number: true,
          address_neighborhood: true, address_city: true, address_state: true, address_zip: true,
          mobile: true, phone: true,
        },
      },
    },
    orderBy: { os_number: 'asc' },
    take: 200,
  })

  // Also identify which requested numbers weren't found (pra UI avisar)
  const foundNumbers = new Set(orders.map(o => o.os_number))
  const missing = numbers.filter(n => !foundNumbers.has(n))

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
    // Heuristica: status "Coletar" ou "Coleta" → COLETA, "Entregar*" → ENTREGA
    const isColeta = /colet/i.test(statusName)
    const suggestedType: 'COLETA' | 'ENTREGA' = isColeta ? 'COLETA' : 'ENTREGA'

    return {
      os_id: os.id,
      os_number: os.os_number,
      status: statusName,
      suggested_type: suggestedType,
      customer_id: c?.id || null,
      customer_name: c?.trade_name || c?.legal_name || '',
      customer_phone: c?.mobile || c?.phone || '',
      address: fullAddress,
      equipment: [os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' '),
    }
  })

  return NextResponse.json({
    data: {
      items,
      missing,     // OS numbers informados mas não encontrados
      total: items.length,
    },
  })
}
