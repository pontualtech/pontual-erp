import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getPortalUserFromRequest } from '@/lib/portal-auth'
import { getPaymentProvider } from '@/lib/payments/factory'

export async function POST(req: NextRequest) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { service_order_id } = await req.json()

    if (!service_order_id) {
      return NextResponse.json({ error: 'service_order_id obrigatorio' }, { status: 400 })
    }

    // Load OS with customer data
    const os = await prisma.serviceOrder.findFirst({
      where: {
        id: service_order_id,
        company_id: portalUser.company_id,
        customer_id: portalUser.customer_id,
        deleted_at: null,
      },
      include: {
        customers: {
          select: { legal_name: true, document_number: true },
        },
        companies: {
          select: { name: true },
        },
      },
    })

    if (!os) {
      return NextResponse.json({ error: 'OS nao encontrada' }, { status: 404 })
    }

    if (!os.total_cost || os.total_cost <= 0) {
      return NextResponse.json({ error: 'OS sem valor definido' }, { status: 400 })
    }

    // Check for existing pending payment (idempotency)
    const existingPayment = await prisma.payment.findFirst({
      where: {
        service_order_id,
        company_id: portalUser.company_id,
        status: 'PENDING',
        expires_at: { gte: new Date() },
      },
    })

    if (existingPayment) {
      return NextResponse.json({
        data: {
          id: existingPayment.id,
          qr_code: existingPayment.qr_code,
          qr_code_image: existingPayment.qr_code_image,
          amount: existingPayment.amount,
          status: existingPayment.status,
          expires_at: existingPayment.expires_at,
        },
      })
    }

    // Create payment via provider
    const provider = getPaymentProvider()
    const idempotencyKey = `${portalUser.company_id}_${service_order_id}_${Date.now()}`

    const charge = await provider.createPixCharge({
      amount: os.total_cost,
      customerName: os.customers?.legal_name || 'Cliente',
      customerDocument: os.customers?.document_number || '',
      description: `OS #${os.os_number} - ${os.companies?.name || 'PontualERP'}`,
      idempotencyKey,
      expiresInMinutes: 30,
    })

    // Save to database
    const payment = await prisma.payment.create({
      data: {
        company_id: portalUser.company_id,
        service_order_id,
        customer_id: portalUser.customer_id,
        provider: provider.name,
        external_id: charge.externalId,
        idempotency_key: idempotencyKey,
        amount: os.total_cost,
        status: 'PENDING',
        method: 'PIX',
        qr_code: charge.qrCode,
        qr_code_image: charge.qrCodeImage || null,
        expires_at: charge.expiresAt,
      },
    })

    return NextResponse.json({
      data: {
        id: payment.id,
        qr_code: payment.qr_code,
        qr_code_image: payment.qr_code_image,
        amount: payment.amount,
        status: payment.status,
        expires_at: payment.expires_at,
      },
    })
  } catch (err) {
    console.error('[Portal PIX Create Error]', err)
    return NextResponse.json({ error: 'Erro ao gerar pagamento PIX' }, { status: 500 })
  }
}
