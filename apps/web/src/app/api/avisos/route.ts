import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('core', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const showExpired = req.nextUrl.searchParams.get('showExpired') === 'true'

    const where: any = {
      company_id: user.companyId,
    }

    if (!showExpired) {
      where.OR = [
        { expires_at: null },
        { expires_at: { gt: new Date() } },
      ]
    }

    const announcements = await prisma.announcement.findMany({
      where,
      orderBy: [
        { pinned: 'desc' },
        { created_at: 'desc' },
      ],
      include: {
        reads: {
          where: { user_id: user.id },
          select: { read_at: true },
        },
        _count: {
          select: { reads: true },
        },
      },
    })

    // Mapeia resultados com status de leitura
    const mapped = announcements.map((a) => ({
      ...a,
      is_read: a.reads.length > 0,
      read_count: a._count.reads,
      reads: undefined,
      _count: undefined,
    }))

    return success(mapped)
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('core', 'create')
    if (result instanceof NextResponse) return result
    const user = result

    // Only admin can create announcements
    if (!['admin', 'owner'].includes(user.roleName)) {
      return error('Apenas administradores podem criar avisos', 403)
    }

    const body = await req.json()

    if (!body.title?.trim()) return error('Titulo e obrigatorio')
    if (!body.message?.trim()) return error('Mensagem e obrigatoria')

    const announcement = await prisma.announcement.create({
      data: {
        company_id: user.companyId,
        title: body.title.trim(),
        message: body.message.trim(),
        priority: body.priority || 'NORMAL',
        created_by: user.id,
        author_name: user.name,
        pinned: body.pinned || false,
        require_read: body.require_read || false,
        expires_at: body.expires_at ? new Date(body.expires_at) : null,
      },
    })

    return success(announcement, 201)
  } catch (err) {
    return handleError(err)
  }
}
