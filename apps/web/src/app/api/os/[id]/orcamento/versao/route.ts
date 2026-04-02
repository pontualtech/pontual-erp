import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

type Params = { params: { id: string } }

/**
 * POST /api/os/[id]/orcamento/versao
 * Creates a new version of the quote for this OS.
 * Copies items from the latest existing quote (or from OS items if no quote exists).
 * Marks older versions as SUPERSEDED.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const os = await prisma.serviceOrder.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      include: {
        service_order_items: { where: { deleted_at: null } },
        quotes: {
          orderBy: { version: 'desc' },
          include: { quote_items: true },
        },
      },
    })
    if (!os) return error('OS nao encontrada', 404)

    const body = await req.json().catch(() => ({}))
    const { items: customItems, notes, validUntil } = body as {
      items?: { description: string; quantity: number; unit_price: number; total_price: number }[]
      notes?: string
      validUntil?: string
    }

    // Determine next version number for this OS
    const maxVersion = os.quotes.length > 0
      ? Math.max(...os.quotes.map(q => q.version))
      : 0
    const newVersion = maxVersion + 1

    // Auto-increment global quote number
    const lastQuote = await prisma.quote.findFirst({
      where: { company_id: user.companyId },
      orderBy: { quote_number: 'desc' },
      select: { quote_number: true },
    })
    const newQuoteNumber = (lastQuote?.quote_number || 0) + 1

    // Decide which items to copy: custom items > latest quote items > OS items
    const latestQuote = os.quotes[0] // already sorted desc by version
    let itemsToCreate: { description: string; quantity: number; unit_price: number; total_price: number }[]

    if (customItems && customItems.length > 0) {
      itemsToCreate = customItems.map(i => ({
        description: i.description,
        quantity: i.quantity || 1,
        unit_price: i.unit_price || 0,
        total_price: i.total_price || Math.round((i.quantity || 1) * (i.unit_price || 0)),
      }))
    } else if (latestQuote) {
      itemsToCreate = latestQuote.quote_items.map(i => ({
        description: i.description,
        quantity: i.quantity,
        unit_price: i.unit_price,
        total_price: i.total_price,
      }))
    } else {
      itemsToCreate = os.service_order_items.map(i => ({
        description: i.description,
        quantity: i.quantity,
        unit_price: i.unit_price,
        total_price: i.total_price,
      }))
    }

    const totalAmount = itemsToCreate.reduce((s, i) => s + i.total_price, 0)

    // Transaction: mark old versions as SUPERSEDED + create new quote
    const newQuote = await prisma.$transaction(async (tx) => {
      // Mark all previous quotes for this OS as SUPERSEDED (only active ones)
      await tx.quote.updateMany({
        where: {
          company_id: user.companyId,
          service_order_id: params.id,
          status: { notIn: ['SUPERSEDED', 'APPROVED', 'REJECTED'] },
        },
        data: {
          status: 'SUPERSEDED',
          updated_at: new Date(),
        },
      })

      // Create new quote version
      const quote = await tx.quote.create({
        data: {
          company_id: user.companyId,
          service_order_id: params.id,
          quote_number: newQuoteNumber,
          version: newVersion,
          status: 'DRAFT',
          total_amount: totalAmount,
          valid_until: validUntil ? new Date(validUntil) : null,
          notes: notes || null,
          quote_items: {
            create: itemsToCreate,
          },
        },
        include: { quote_items: true },
      })

      return quote
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'os',
      action: 'create_quote_version',
      entityId: params.id,
      newValue: { quoteId: newQuote.id, quoteNumber: newQuote.quote_number, version: newVersion },
    })

    return success(newQuote, 201)
  } catch (err) {
    return handleError(err)
  }
}

/**
 * GET /api/os/[id]/orcamento/versao
 * Returns all quote versions for this OS, ordered by version desc.
 */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const os = await prisma.serviceOrder.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      select: { id: true },
    })
    if (!os) return error('OS nao encontrada', 404)

    const quotes = await prisma.quote.findMany({
      where: { company_id: user.companyId, service_order_id: params.id },
      orderBy: { version: 'desc' },
      include: { quote_items: true },
    })

    return success(quotes)
  } catch (err) {
    return handleError(err)
  }
}
