import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

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
    const { id, fileName } = params

    // Sanitizar nome do arquivo
    if (fileName.includes('..') || fileName.includes('/')) {
      return new NextResponse('Forbidden', { status: 403 })
    }

    const baseDir = existsSync('/app/uploads') ? '/app/uploads' : join(process.cwd(), 'uploads')
    const filePath = join(baseDir, 'os', id, fileName)

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
