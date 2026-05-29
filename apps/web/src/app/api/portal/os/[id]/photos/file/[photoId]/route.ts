import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getPortalUserFromRequest } from '@/lib/portal-auth'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { isS3Url, signedUrlForS3 } from '@/lib/storage/photos'
import { isImprimitechHandoffStatus } from '@/lib/imprimitech-handoff'

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
          select: {
            customer_id: true,
            module_statuses: { select: { name: true } },
          },
        },
      },
    })

    if (!photo || photo.service_orders.customer_id !== portalUser.customer_id) {
      return NextResponse.json({ error: 'Nao encontrado' }, { status: 404 })
    }

    // Wave 1.2 audit Hi15: gate handoff — fecha bypass do parent /photos. Sem
    // este gate cliente com signed_url cacheado ou photo_id direto baixava
    // bytes da foto (pode conter laudo técnico) mesmo após OS virar Imprim.
    if (isImprimitechHandoffStatus(photo.service_orders.module_statuses?.name)) {
      return NextResponse.json({ error: 'Nao encontrado' }, { status: 404 })
    }

    if (photo.url.startsWith('http')) {
      return NextResponse.redirect(photo.url)
    }

    // S3: redireciona pra signed URL com expiração curta
    if (isS3Url(photo.url)) {
      const signed = await signedUrlForS3(photo.url, 600)
      if (!signed) return NextResponse.json({ error: 'Arquivo nao encontrado' }, { status: 404 })
      return NextResponse.redirect(signed, 302)
    }

    const fullPath = path.resolve(path.join(UPLOAD_DIR, photo.url))
    if (!fullPath.startsWith(path.resolve(UPLOAD_DIR)) || !existsSync(fullPath)) {
      return NextResponse.json({ error: 'Arquivo nao encontrado' }, { status: 404 })
    }

    const fileBuffer = await readFile(fullPath)
    const ext = photo.url.split('.').pop()?.toLowerCase() || 'jpg'
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=3600',
        'Content-Disposition': `inline; filename="os-photo-${params.photoId}.${ext}"`,
      },
    })
  } catch (err) {
    console.error('[Portal Photo File Error]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
