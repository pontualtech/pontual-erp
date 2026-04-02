import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getPortalUserFromRequest } from '@/lib/portal-auth'

export async function POST(req: NextRequest) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const body = await req.json()
    const { service_order_id, score, comment } = body

    // Validar campos obrigatorios
    if (!service_order_id || score === undefined || score === null) {
      return NextResponse.json(
        { error: 'service_order_id e score sao obrigatorios' },
        { status: 400 }
      )
    }

    // Validar score 0-10
    const numScore = Number(score)
    if (!Number.isInteger(numScore) || numScore < 0 || numScore > 10) {
      return NextResponse.json(
        { error: 'Score deve ser um numero inteiro entre 0 e 10' },
        { status: 400 }
      )
    }

    // Verificar que a OS pertence ao cliente
    const os = await prisma.serviceOrder.findFirst({
      where: {
        id: service_order_id,
        company_id: portalUser.company_id,
        customer_id: portalUser.customer_id,
        deleted_at: null,
      },
      include: {
        module_statuses: true,
      },
    })

    if (!os) {
      return NextResponse.json({ error: 'OS nao encontrada' }, { status: 404 })
    }

    // Verificar status final (is_final ou nome contendo Entregue/Cancelada)
    const statusName = os.module_statuses.name.toLowerCase()
    const isFinal = os.module_statuses.is_final ||
      statusName.includes('entregue') ||
      statusName.includes('cancelad')

    if (!isFinal) {
      return NextResponse.json(
        { error: 'Pesquisa de satisfacao so pode ser enviada para OS finalizadas' },
        { status: 400 }
      )
    }

    // Verificar duplicidade
    const existing = await prisma.npsSurvey.findUnique({
      where: {
        service_order_id_customer_id: {
          service_order_id,
          customer_id: portalUser.customer_id,
        },
      },
    })

    if (existing) {
      return NextResponse.json(
        { error: 'Voce ja respondeu a pesquisa para esta OS' },
        { status: 409 }
      )
    }

    // Criar pesquisa NPS
    await prisma.npsSurvey.create({
      data: {
        company_id: portalUser.company_id,
        service_order_id,
        customer_id: portalUser.customer_id,
        score: numScore,
        comment: comment?.trim() || null,
      },
    })

    return NextResponse.json({ data: { success: true, message: 'Obrigado pela sua avaliacao!' } })
  } catch (err) {
    console.error('[Portal NPS Error]', err)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const url = req.nextUrl.searchParams
    const service_order_id = url.get('service_order_id')

    if (!service_order_id) {
      return NextResponse.json(
        { error: 'service_order_id e obrigatorio' },
        { status: 400 }
      )
    }

    const existing = await prisma.npsSurvey.findUnique({
      where: {
        service_order_id_customer_id: {
          service_order_id,
          customer_id: portalUser.customer_id,
        },
      },
      select: {
        id: true,
        score: true,
        comment: true,
        created_at: true,
      },
    })

    return NextResponse.json({ data: existing })
  } catch (err) {
    console.error('[Portal NPS GET Error]', err)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
