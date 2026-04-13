import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { authenticateBot } from '../_lib/auth'
import { botSuccess, botError } from '../_lib/response'

export async function PATCH(req: NextRequest) {
  const auth = authenticateBot(req)
  if (auth instanceof NextResponse) return auth

  const body = await req.json()
  const { cliente_id, chatwoot_contact_id, chatwoot_url } = body

  if (!cliente_id) return botError('cliente_id obrigatorio')

  const customer = await prisma.customer.findFirst({
    where: { id: cliente_id, company_id: auth.companyId, deleted_at: null },
  })

  if (!customer) return botError('Cliente nao encontrado', 404)

  // Save Chatwoot data in customer's custom_data JSON field
  const currentData = (customer.custom_data || {}) as Record<string, any>
  const updatedData = {
    ...currentData,
    chatwoot_contact_id: chatwoot_contact_id || currentData.chatwoot_contact_id,
    chatwoot_url: chatwoot_url || currentData.chatwoot_url,
    chatwoot_synced_at: new Date().toISOString(),
  }

  await prisma.customer.update({
    where: { id: cliente_id, company_id: auth.companyId },
    data: { custom_data: updatedData },
  })

  return botSuccess({ updated: true, cliente_id })
}
