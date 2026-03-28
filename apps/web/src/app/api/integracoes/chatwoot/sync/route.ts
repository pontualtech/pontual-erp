import { NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { searchContact } from '@/lib/chatwoot'

// POST: sync all Chatwoot contacts to ERP customers
export async function POST() {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const CHATWOOT_URL = process.env.CHATWOOT_URL || ''
    const CHATWOOT_TOKEN = process.env.CHATWOOT_API_TOKEN || ''
    const CHATWOOT_ACCOUNT = process.env.CHATWOOT_ACCOUNT_ID || '1'

    if (!CHATWOOT_TOKEN) return error('Chatwoot não configurado', 503)

    // Fetch contacts from Chatwoot (page by page, max 5 pages)
    let created = 0, updated = 0, skipped = 0
    for (let page = 1; page <= 5; page++) {
      const res = await fetch(`${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT}/contacts?page=${page}`, {
        headers: { api_access_token: CHATWOOT_TOKEN },
      })
      if (!res.ok) break

      const data: any = await res.json()
      const contacts = data.payload || data || []
      if (!Array.isArray(contacts) || contacts.length === 0) break

      for (const c of contacts) {
        const phone = (c.phone_number || '').replace(/\D/g, '')
        const name = c.name || ''
        const email = c.email || ''

        if (!name || name === '.' || (!phone && !email)) { skipped++; continue }

        const cleanPhone = phone.slice(-10)
        const whereConditions: any[] = []
        if (cleanPhone.length >= 10) {
          whereConditions.push({ mobile: { contains: cleanPhone } })
          whereConditions.push({ phone: { contains: cleanPhone } })
        }
        if (email) whereConditions.push({ email: { equals: email, mode: 'insensitive' as const } })
        if (whereConditions.length === 0) { skipped++; continue }

        const existing = await prisma.customer.findFirst({
          where: { company_id: user.companyId, deleted_at: null, OR: whereConditions },
        })

        if (existing) {
          const updates: any = {}
          if (email && !existing.email) updates.email = email
          if (name.length > (existing.legal_name?.length || 0)) updates.legal_name = name
          if (Object.keys(updates).length > 0) {
            await prisma.customer.update({ where: { id: existing.id }, data: updates })
            updated++
          } else { skipped++ }
        } else {
          await prisma.customer.create({
            data: {
              company_id: user.companyId,
              legal_name: name,
              person_type: 'FISICA',
              customer_type: 'CLIENTE',
              mobile: phone || null,
              email: email || null,
              notes: 'Importado do Chatwoot/WhatsApp',
            },
          })
          created++
        }
      }
    }

    return success({ created, updated, skipped })
  } catch (err) {
    return handleError(err)
  }
}
