import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getPortalUserFromRequest } from '@/lib/portal-auth'
import { unlink } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { uploadPhotoBuffer, isS3Url, deleteS3Object, isS3Configured } from '@/lib/storage/photos'
import { isImprimitechHandoffStatus } from '@/lib/imprimitech-handoff'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
const MAX_FILES_PER_OS = 10
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/app/uploads'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const os = await prisma.serviceOrder.findFirst({
      where: {
        id: params.id,
        company_id: portalUser.company_id,
        customer_id: portalUser.customer_id,
        deleted_at: null,
      },
      select: { id: true, module_statuses: { select: { name: true } } },
    })

    if (!os) {
      return NextResponse.json({ error: 'OS nao encontrada' }, { status: 404 })
    }

    // Wave 1.1 audit H1: gate handoff em GET — cliente não vê fotos de OS transferida.
    if (isImprimitechHandoffStatus(os.module_statuses?.name)) {
      return NextResponse.json({ error: 'OS nao encontrada' }, { status: 404 })
    }

    const photos = await prisma.serviceOrderPhoto.findMany({
      where: {
        service_order_id: params.id,
        company_id: portalUser.company_id,
      },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        url: true,
        label: true,
        uploaded_by: true,
        created_at: true,
      },
    })

    // Convert filesystem paths to API URLs
    const photosWithUrls = photos.map(photo => ({
      ...photo,
      signed_url: photo.url.startsWith('http')
        ? photo.url
        : `/api/portal/os/${params.id}/photos/file/${photo.id}`,
    }))

    return NextResponse.json({ data: photosWithUrls })
  } catch (err) {
    console.error('[Portal Photos GET Error]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const os = await prisma.serviceOrder.findFirst({
      where: {
        id: params.id,
        company_id: portalUser.company_id,
        customer_id: portalUser.customer_id,
        deleted_at: null,
      },
      select: { id: true, os_number: true, module_statuses: { select: { name: true } } },
    })

    if (!os) {
      return NextResponse.json({ error: 'OS nao encontrada' }, { status: 404 })
    }

    // Wave 1.1 audit H1: gate handoff em POST — cliente não sobe foto em OS transferida.
    if (isImprimitechHandoffStatus(os.module_statuses?.name)) {
      return NextResponse.json({ error: 'OS nao encontrada' }, { status: 404 })
    }

    const currentCount = await prisma.serviceOrderPhoto.count({
      where: {
        service_order_id: params.id,
        company_id: portalUser.company_id,
      },
    })

    if (currentCount >= MAX_FILES_PER_OS) {
      return NextResponse.json(
        { error: `Limite de ${MAX_FILES_PER_OS} arquivos por OS atingido` },
        { status: 400 }
      )
    }

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const label = (formData.get('label') as string) || 'cliente'

    if (!file) {
      return NextResponse.json({ error: 'Nenhum arquivo enviado' }, { status: 400 })
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Tipo de arquivo nao permitido. Use JPEG, PNG, WebP ou PDF.' },
        { status: 400 }
      )
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'Arquivo muito grande. Maximo 10MB.' },
        { status: 400 }
      )
    }

    if (!isS3Configured()) {
      return NextResponse.json({ error: 'Storage S3 nao configurado' }, { status: 500 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const { dbUrl } = await uploadPhotoBuffer({
      companyId: portalUser.company_id,
      serviceOrderId: params.id,
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      buffer,
    })

    const photo = await prisma.serviceOrderPhoto.create({
      data: {
        company_id: portalUser.company_id,
        service_order_id: params.id,
        url: dbUrl,
        label,
        uploaded_by: portalUser.customer_id,
      },
    })

    return NextResponse.json({
      data: {
        id: photo.id,
        url: dbUrl,
        signed_url: `/api/portal/os/${params.id}/photos/file/${photo.id}`,
        label,
        created_at: photo.created_at,
      },
    })
  } catch (err) {
    console.error('[Portal Photos POST Error]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    const { photo_id } = await req.json()
    if (!photo_id) {
      return NextResponse.json({ error: 'photo_id obrigatorio' }, { status: 400 })
    }

    // Wave 1.1 audit H1: gate handoff em DELETE — cliente não deleta foto de OS transferida.
    const osCheck = await prisma.serviceOrder.findFirst({
      where: {
        id: params.id,
        company_id: portalUser.company_id,
        customer_id: portalUser.customer_id,
        deleted_at: null,
      },
      select: { id: true, module_statuses: { select: { name: true } } },
    })
    if (!osCheck || isImprimitechHandoffStatus(osCheck.module_statuses?.name)) {
      return NextResponse.json({ error: 'Foto nao encontrada' }, { status: 404 })
    }

    const photo = await prisma.serviceOrderPhoto.findFirst({
      where: {
        id: photo_id,
        service_order_id: params.id,
        company_id: portalUser.company_id,
        uploaded_by: portalUser.customer_id,
      },
    })

    if (!photo) {
      return NextResponse.json({ error: 'Foto nao encontrada' }, { status: 404 })
    }

    // Delete: S3 ou filesystem legacy
    if (isS3Url(photo.url)) {
      await deleteS3Object(photo.url)
    } else if (photo.url && !photo.url.startsWith('http')) {
      const fullPath = path.join(UPLOAD_DIR, photo.url)
      try { await unlink(fullPath) } catch {}
    }

    await prisma.serviceOrderPhoto.delete({ where: { id: photo_id } })

    return NextResponse.json({ data: { success: true } })
  } catch (err) {
    console.error('[Portal Photos DELETE Error]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
