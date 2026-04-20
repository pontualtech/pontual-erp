import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'

/**
 * Admin-only endpoint to bootstrap a driver for testing.
 *
 * GET  /api/admin/driver-setup?name=Emerson
 *   Diagnoses: user found? which role? has route today?
 *
 * POST /api/admin/driver-setup
 *   Body: { name: string, create_test_route?: boolean }
 *   Actions (idempotent):
 *     1. Find UserProfile by `name` (LIKE match, first active)
 *     2. Ensure a role named "Motorista" exists for this company
 *     3. Assign the role to the user (only if current role isn't already driver-like)
 *     4. If create_test_route, create today's LogisticsRoute with 2 example
 *        stops (1 COLETA, 1 ENTREGA) so the driver sees something in
 *        /motorista/rota immediately
 *
 * Guarded by permission 'admin.edit' — typically super_admin + admin roles.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePermission('admin', 'edit')
  if (auth instanceof NextResponse) return auth

  const name = req.nextUrl.searchParams.get('name') || 'Emerson'
  const report = await buildReport(auth.companyId, name)
  return NextResponse.json({ data: report })
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission('admin', 'edit')
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => ({}))
  const name: string = (body.name || 'Emerson').trim()
  const createTestRoute: boolean = body.create_test_route !== false // default true

  const user = await prisma.userProfile.findFirst({
    where: {
      company_id: auth.companyId,
      is_active: true,
      OR: [
        { name: { contains: name, mode: 'insensitive' } },
        { email: { contains: name, mode: 'insensitive' } },
      ],
    },
    include: { roles: true },
  })
  if (!user) {
    return NextResponse.json({ error: `Usuario '${name}' nao encontrado` }, { status: 404 })
  }

  // 1. Role "Motorista" — garante que existe
  let driverRole = await prisma.role.findFirst({
    where: { company_id: auth.companyId, name: { contains: 'motorista', mode: 'insensitive' } },
  })
  if (!driverRole) {
    driverRole = await prisma.role.create({
      data: {
        company_id: auth.companyId,
        name: 'Motorista',
        description: 'Motorista de campo — app PWA /motorista',
        is_system: false,
        is_active: true,
      },
    })
  }

  // 2. Atribui role ao user (só se nao for ja driver-like)
  const currentRoleIsDriver = user.roles.name.toLowerCase().includes('motorista')
    || user.roles.name.toLowerCase().includes('driver')
  let roleAssigned = false
  if (!currentRoleIsDriver) {
    await prisma.userProfile.update({
      where: { id: user.id },
      data: { role_id: driverRole.id },
    })
    roleAssigned = true
  }

  // 3. Rota de hoje — cria se nao existir
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  let route = await prisma.logisticsRoute.findFirst({
    where: { company_id: auth.companyId, driver_id: user.id, date: { gte: today, lt: tomorrow } },
  })
  let routeCreated = false
  let stopsCreated = 0

  if (!route && createTestRoute) {
    route = await prisma.logisticsRoute.create({
      data: {
        company_id: auth.companyId,
        driver_id: user.id,
        date: today,
        status: 'IN_PROGRESS',
        total_stops: 2,
        completed_stops: 0,
        started_at: new Date(),
        notes: 'Rota de teste criada via /api/admin/driver-setup',
      },
    })
    routeCreated = true

    // Cria 2 stops: 1 coleta + 1 entrega (com endereços genéricos em SP)
    const stops = [
      {
        type: 'COLETA', sequence: 1,
        customer_name: 'Cliente Teste Coleta',
        customer_phone: '11999990001',
        address: 'Av. Paulista, 1000 - Bela Vista - São Paulo/SP',
        lat: -23.5618, lng: -46.6565,
      },
      {
        type: 'ENTREGA', sequence: 2,
        customer_name: 'Cliente Teste Entrega',
        customer_phone: '11999990002',
        address: 'Rua Oscar Freire, 500 - Jardins - São Paulo/SP',
        lat: -23.5629, lng: -46.6707,
      },
    ]
    for (const s of stops) {
      await prisma.logisticsStop.create({
        data: {
          company_id: auth.companyId,
          route_id: route.id,
          type: s.type,
          sequence: s.sequence,
          status: 'PENDING',
          customer_name: s.customer_name,
          customer_phone: s.customer_phone,
          address: s.address,
          lat: s.lat,
          lng: s.lng,
        },
      })
      stopsCreated++
    }
  }

  const report = await buildReport(auth.companyId, name)
  return NextResponse.json({
    data: {
      actions: {
        driver_role_created: !driverRole ? false : driverRole.id !== user.role_id,
        role_assigned: roleAssigned,
        route_created: routeCreated,
        stops_created: stopsCreated,
      },
      instructions: `Diga pro ${user.name} abrir: https://erp.pontualtech.work/motorista/rota (logar com o email ${user.email})`,
      ...report,
    },
  })
}

async function buildReport(companyId: string, searchName: string) {
  const user = await prisma.userProfile.findFirst({
    where: {
      company_id: companyId,
      is_active: true,
      OR: [
        { name: { contains: searchName, mode: 'insensitive' } },
        { email: { contains: searchName, mode: 'insensitive' } },
      ],
    },
    include: { roles: true },
  })
  if (!user) return { user: null, search: searchName }

  const isDriver = user.roles.name.toLowerCase().includes('motorista')
    || user.roles.name.toLowerCase().includes('driver')

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  const route = await prisma.logisticsRoute.findFirst({
    where: { company_id: companyId, driver_id: user.id, date: { gte: today, lt: tomorrow } },
    include: { stops: { orderBy: { sequence: 'asc' } } },
  })

  return {
    user: { id: user.id, name: user.name, email: user.email, role: user.roles.name, is_driver: isDriver },
    route: route ? {
      id: route.id, status: route.status, total_stops: route.total_stops,
      completed_stops: route.completed_stops, stops_count: route.stops.length,
    } : null,
  }
}
