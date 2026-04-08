import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getPortalUserFromRequest } from '@/lib/portal-auth'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/app/uploads'

const MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; photoId: string } }
) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    // Verify photo belongs to customer's OS
    const photo = await prisma.serviceOrderPhoto.findFirst({
      where: {
        id: params.photoId,
        service_order_id: params.id,
        company_id: portalUser.company_id,
      },
      include: {
        service_orders: {
          select: { customer_id: true },
        },
      },
    })

    if (!photo || photo.service_orders.customer_id !== portalUser.customer_id) {
      return NextResponse.json({ error: 'Nao encontrado' }, { status: 404 })
    }

    if (photo.url.startsWith('http')) {
      return NextResponse.redirect(photo.url)
    }

    const fullPath = path.join(UPLOAD_DIR, photo.url)
    if (!existsSync(fullPath)) {
      return NextResponse.json({ error: 'Arquivo nao encontrado' }, { status: 404 })
    }

    const fileBuffer = await readFile(fullPath)
    const ext = photo.url.split('.').pop()?.toLowerCase() || 'jpg'
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=3600',
        'Content-Disposition': `inline; filename="os-photo-${params.photoId}.${ext}"`,
      },
    })
  } catch (err) {
    console.error('[Portal Photo File Error]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
