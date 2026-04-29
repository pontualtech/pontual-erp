/**
 * GET /api/voip/calls/[id] — detalhe de uma chamada (CDR + recording metadata)
 */

import { NextRequest } from 'next/server'
import { prisma } from '@pontual/db'
import { requireAuth } from '@/lib/auth'
import { error, handleError, success } from '@/lib/api-response'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const user = await requireAuth()

    const call = await prisma.voipCall.findFirst({
      where: {
        id: params.id,
        company_id: user.companyId,
      },
      include: {
        customers: {
          select: { id: true, legal_name: true, trade_name: true, mobile: true, phone: true, document_number: true },
        },
        user_profiles: {
          select: { id: true, name: true, email: true },
        },
      },
    })

    if (!call) {
      return error('Chamada não encontrada', 404)
    }

    return success(call)
  } catch (e) {
    return handleError(e)
  }
}
