import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { updateCustomerSchema, normalizeDocument } from '@/lib/validations/clientes'

type Params = { params: { id: string } }

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('clientes', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const customer = await prisma.customer.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      include: {
        service_orders: {
          where: { deleted_at: null },
          orderBy: { created_at: 'desc' },
          take: 10,
          include: {
            module_statuses: { select: { name: true, color: true } },
          },
        },
      },
    })

    if (!customer) return error('Cliente não encontrado', 404)

    // IDOR protection: motorista only gets limited fields (logistics-relevant data)
    if (user.roleName === 'motorista') {
      return success({
        id: customer.id,
        legal_name: customer.legal_name,
        trade_name: customer.trade_name,
        phone: customer.phone,
        mobile: customer.mobile,
        address_street: customer.address_street,
        address_number: customer.address_number,
        address_complement: customer.address_complement,
        address_neighborhood: customer.address_neighborhood,
        address_city: customer.address_city,
        address_state: customer.address_state,
        address_zip: customer.address_zip,
      })
    }

    return success(customer)
  } catch (err) {
    return handleError(err)
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  return PUT(req, { params })
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('clientes', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.customer.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!existing) return error('Cliente não encontrado', 404)

    const body = await req.json()
    // Validar com Zod strict — rejeita campos não permitidos
    const validatedData = updateCustomerSchema.parse(body)

    // 2026-05-22 fix incidente Sonia/Ludmila (OSs 60605/60607/60608):
    // Atendente editou customer existente trocando dados pra OUTRO cliente
    // (mobile/email/CPF que ja pertenciam a outro customer cadastrado),
    // sobrescrevendo o primeiro. Agora PATCH detecta conflito e bloqueia,
    // a nao ser que caller passe `_allow_overwrite_other: true` confirmando
    // que sabe o que esta fazendo (ex: merge intencional).
    const allowOverwrite = (body as any)?._allow_overwrite_other === true
    if (!allowOverwrite) {
      const newDoc = (validatedData as any).document_number || ''
      const newMobile = (validatedData as any).mobile ? String((validatedData as any).mobile).replace(/\D/g, '') : ''
      const newEmail = (validatedData as any).email ? String((validatedData as any).email).trim().toLowerCase() : ''
      const docChanged = newDoc && newDoc !== (existing.document_number || '')
      const mobileChanged = newMobile && newMobile !== ((existing.mobile || '').replace(/\D/g, ''))
      const emailChanged = newEmail && newEmail !== ((existing.email || '').trim().toLowerCase())

      if (docChanged || mobileChanged || emailChanged) {
        const conflictConditions: any[] = []
        if (docChanged && newDoc.length >= 11) conflictConditions.push({ document_number: newDoc })
        if (mobileChanged && newMobile.length >= 10) conflictConditions.push({ mobile: { contains: newMobile.slice(-10) } })
        if (emailChanged) conflictConditions.push({ email: { equals: newEmail, mode: 'insensitive' as const } })

        if (conflictConditions.length > 0) {
          const conflictWith = await prisma.customer.findFirst({
            where: {
              company_id: user.companyId,
              deleted_at: null,
              id: { not: params.id },
              OR: conflictConditions,
            },
            select: { id: true, legal_name: true, email: true, mobile: true, document_number: true },
          })
          if (conflictWith) {
            const reasons: string[] = []
            if (docChanged && conflictWith.document_number === newDoc) reasons.push('CPF/CNPJ')
            if (mobileChanged && conflictWith.mobile?.includes(newMobile.slice(-10))) reasons.push('celular')
            if (emailChanged && conflictWith.email?.toLowerCase() === newEmail) reasons.push('email')
            return NextResponse.json({
              error: `Outro cliente ja tem ${reasons.join(', ')} igual. Edite o cliente correto ou confirme a sobrescrita explicitamente.`,
              conflict_with: conflictWith,
              match_fields: reasons,
              hint: 'Se realmente quer fazer merge, envie _allow_overwrite_other=true no body.',
            }, { status: 409 })
          }
        }
      }
    }

    await prisma.customer.updateMany({
      where: { id: params.id, company_id: user.companyId },
      data: validatedData as any,
    })
    const customer = await prisma.customer.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'clientes',
      action: 'update',
      entityId: customer!.id,
      oldValue: existing as any,
      newValue: validatedData,
    })

    return success(customer!)
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('clientes', 'delete')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.customer.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!existing) return error('Cliente não encontrado', 404)

    await prisma.customer.updateMany({
      where: { id: params.id, company_id: user.companyId },
      data: { deleted_at: new Date() },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'clientes',
      action: 'delete',
      entityId: params.id,
    })

    return success({ deleted: true })
  } catch (err) {
    return handleError(err)
  }
}
