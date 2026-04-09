import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getPortalUserFromRequest } from '@/lib/portal-auth'
import { sendEmail } from '@/lib/send-email'

export async function GET(req: NextRequest) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const customer = await prisma.customer.findUnique({
      where: { id: portalUser.customer_id },
      select: {
        id: true,
        legal_name: true,
        email: true,
        phone: true,
        mobile: true,
        address_street: true,
        address_number: true,
        address_complement: true,
        address_neighborhood: true,
        address_city: true,
        address_state: true,
        address_zip: true,
        document_number: true,
        person_type: true,
      },
    })

    if (!customer) {
      return NextResponse.json({ error: 'Cliente nao encontrado' }, { status: 404 })
    }

    return NextResponse.json({ data: customer })
  } catch (err) {
    console.error('[Portal Profile GET Error]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const body = await req.json()
    const { email, phone, mobile, address_street, address_number, address_complement, address_neighborhood, address_city, address_state, address_zip } = body

    // Load current data for comparison
    const current = await prisma.customer.findUnique({
      where: { id: portalUser.customer_id },
      select: { legal_name: true, email: true, phone: true, mobile: true, address_street: true, address_number: true, address_city: true, address_state: true },
    })

    if (!current) {
      return NextResponse.json({ error: 'Cliente nao encontrado' }, { status: 404 })
    }

    // Build changes object (only update what changed)
    const changes: Record<string, unknown> = {}
    if (email !== undefined && email !== current.email) changes.email = email
    if (phone !== undefined && phone !== current.phone) changes.phone = phone
    if (mobile !== undefined && mobile !== current.mobile) changes.mobile = mobile
    if (address_street !== undefined) changes.address_street = address_street
    if (address_number !== undefined) changes.address_number = address_number
    if (address_complement !== undefined) changes.address_complement = address_complement
    if (address_neighborhood !== undefined) changes.address_neighborhood = address_neighborhood
    if (address_city !== undefined) changes.address_city = address_city
    if (address_state !== undefined) changes.address_state = address_state
    if (address_zip !== undefined) changes.address_zip = address_zip?.replace(/\D/g, '')

    if (Object.keys(changes).length === 0) {
      return NextResponse.json({ data: { message: 'Nenhuma alteracao' } })
    }

    // Update customer
    await prisma.customer.update({
      where: { id: portalUser.customer_id },
      data: changes,
    })

    // Log in audit
    await prisma.auditLog.create({
      data: {
        company_id: portalUser.company_id,
        user_id: portalUser.customer_id,
        module: 'portal',
        action: 'profile_updated',
        entity_id: portalUser.customer_id,
        old_value: JSON.parse(JSON.stringify({
          email: current.email,
          phone: current.phone,
          mobile: current.mobile,
          address_city: current.address_city,
          address_state: current.address_state,
        })),
        new_value: JSON.parse(JSON.stringify(changes)),
      },
    })

    // Notify ERP admin via email (fire-and-forget)
    const company = await prisma.company.findUnique({
      where: { id: portalUser.company_id },
      select: { name: true },
    })

    const changedFields = Object.entries(changes)
      .map(([k, v]) => `<li><strong>${k}:</strong> ${v}</li>`)
      .join('')

    void sendEmail(
      'contato@pontualtech.com.br',
      `[Portal] Cliente atualizou cadastro - ${current.legal_name}`,
      `<h3>Cliente atualizou dados pelo portal</h3>
       <p><strong>Cliente:</strong> ${current.legal_name}</p>
       <p><strong>Empresa:</strong> ${company?.name || 'N/I'}</p>
       <p><strong>Campos alterados:</strong></p>
       <ul>${changedFields}</ul>
       <p style="color:#999;font-size:12px;">Notificacao automatica do Portal do Cliente — PontualERP</p>`
    ).catch(err => console.error('[Portal Profile Notify Error]', err))

    return NextResponse.json({ data: { message: 'Dados atualizados com sucesso!' } })
  } catch (err) {
    console.error('[Portal Profile PUT Error]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
