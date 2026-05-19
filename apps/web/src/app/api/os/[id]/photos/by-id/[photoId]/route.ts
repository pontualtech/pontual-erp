import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { join, resolve } from 'path'
import { existsSync } from 'fs'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'

type Params = { params: { id: string; photoId: string } }

const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv', zip: 'application/zip',
}

// Resolve qualquer formato de URL gravada na DB (admin ou portal) para o path
// real no disco dentro de /app/uploads (ou ./uploads em dev).
function resolveDiskPath(baseDir: string, osId: string, dbUrl: string): string | null {
  // Formato admin: /api/os/{osId}/photos/file/{fileName} → /app/uploads/os/{osId}/{fileName}
  const adminMatch = dbUrl.match(/^\/api\/os\/[^/]+\/photos\/file\/(.+)$/)
  if (adminMatch) {
    return resolve(join(baseDir, 'os', osId, adminMatch[1]))
  }
  // Formato portal: {company_id}/{os_id}/{fileName} → /app/uploads/{company_id}/{os_id}/{fileName}
  if (!dbUrl.startsWith('/') && !dbUrl.startsWith('http')) {
    return resolve(join(baseDir, dbUrl))
  }
  return null
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    if (!/^[a-zA-Z0-9-]+$/.test(params.id) || !/^[a-zA-Z0-9-]+$/.test(params.photoId)) {
      return new NextResponse('Forbidden', { status: 403 })
    }

    const photo = await prisma.serviceOrderPhoto.findFirst({
      where: {
        id: params.photoId,
        service_order_id: params.id,
        company_id: user.companyId,
      },
      select: { url: true },
    })
    if (!photo) return new NextResponse('Not found', { status: 404 })

    const baseDir = existsSync('/app/uploads') ? '/app/uploads' : join(process.cwd(), 'uploads')
    const filePath = resolveDiskPath(baseDir, params.id, photo.url)

    if (!filePath || !filePath.startsWith(resolve(baseDir))) {
      return new NextResponse('Forbidden', { status: 403 })
    }
    if (!existsSync(filePath)) {
      return new NextResponse('Not found', { status: 404 })
    }

    const buffer = await readFile(filePath)
    const ext = filePath.split('.').pop()?.toLowerCase() || ''
    const contentType = MIME_MAP[ext] || 'application/octet-stream'

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=86400',
      },
    })
  } catch {
    return new NextResponse('Error', { status: 500 })
  }
}
