import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'
import { listReviews, replyReview } from '@/lib/google-business'

/** GET /api/integracoes/google-business/reviews */
export async function GET(_req: NextRequest) {
  try {
    const result = await requirePermission('config', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const r = await listReviews(user.companyId)
    if (!r.success) return success({ reviews: [], error: r.error })
    return success({ reviews: r.reviews || [] })
  } catch (err) {
    return handleError(err)
  }
}

/** POST /api/integracoes/google-business/reviews body: { name, comment } — responde review */
export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json().catch(() => ({}))
    const name = String(body.name || '')
    const comment = String(body.comment || '').trim()
    if (!name || !comment) return NextResponse.json({ error: 'name e comment obrigatorios' }, { status: 400 })

    const r = await replyReview(user.companyId, name, comment)
    if (!r.success) return NextResponse.json({ error: r.error }, { status: 400 })
    return success({ replied: true })
  } catch (err) {
    return handleError(err)
  }
}
