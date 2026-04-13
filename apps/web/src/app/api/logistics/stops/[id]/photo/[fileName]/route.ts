import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getServerUser } from '@/lib/auth'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

type Params = { params: { id: string; fileName: string } }

const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  html: 'text/html',
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const user = await getServerUser()
    if (!user) return new NextResponse('Unauthorized', { status: 401 })

    const { id, fileName } = params

    // Sanitize filename
    if (fileName.includes('..') || fileName.includes('/')) {
      return new NextResponse('Forbidden', { status: 403 })
    }

    // Find the stop to get route_id for the path and verify company ownership
    const stop = await prisma.logisticsStop.findFirst({
      where: { id },
      select: { route_id: true, route: { select: { company_id: true } } },
    })
    if (!stop) return new NextResponse('Not found', { status: 404 })

    // Verify the stop belongs to the user's company
    if (stop.route?.company_id !== user.companyId) {
      return new NextResponse('Forbidden', { status: 403 })
    }

    const baseDir = existsSync('/app/uploads') ? '/app/uploads' : join(process.cwd(), 'uploads')
    const filePath = join(baseDir, 'logistics', stop.route_id, id, fileName)

    if (!existsSync(filePath)) {
      return new NextResponse('Not found', { status: 404 })
    }

    const buffer = await readFile(filePath)
    const ext = fileName.split('.').pop()?.toLowerCase() || ''
    const contentType = MIME_MAP[ext] || 'application/octet-stream'

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    return new NextResponse('Error', { status: 500 })
  }
}
