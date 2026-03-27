import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

export async function GET(
  _req: NextRequest,
  { params }: { params: { documento: string } }
) {
  try {
    const result = await requirePermission('clientes', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const doc = params.documento.replace(/\D/g, '')
    if (!doc) return error('Documento inválido', 400)

    const customer = await prisma.customer.findFirst({
      where: {
        company_id: user.companyId,
        document_number: { contains: doc },
        deleted_at: null,
      },
    })

    if (!customer) return success(null)
    return success(customer)
  } catch (err) {
    return handleError(err)
  }
}
