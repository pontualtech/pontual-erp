import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { join, resolve } from 'path'
import { existsSync } from 'fs'
import { requirePermission } from '@/lib/auth'

type Params = { params: { id: string; fileName: string } }

const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  pdf: 'application/pdf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv', zip: 'application/zip',
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    // Authentication required
    const result = await requirePermission('os', 'view')
    if (result instanceof NextResponse) return result

    const { id, fileName } = params

    // Sanitizar nome do arquivo (incluindo backslash para Windows)
    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      return new NextResponse('Forbidden', { status: 403 })
    }

    // Validate id format (UUID only)
    if (!/^[a-zA-Z0-9-]+$/.test(id)) {
      return new NextResponse('Forbidden', { status: 403 })
    }

    const baseDir = existsSync('/app/uploads') ? '/app/uploads' : join(process.cwd(), 'uploads')
    const filePath = resolve(join(baseDir, 'os', id, fileName))

    // Ensure resolved path stays within uploads directory
    if (!filePath.startsWith(resolve(baseDir))) {
      return new NextResponse('Forbidden', { status: 403 })
    }

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
