import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getPortalUserFromRequest } from '@/lib/portal-auth'
import { createAdminClient } from '@/lib/supabase/admin'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
const MAX_FILES_PER_OS = 10
const BUCKET = 'portal-uploads'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) {
      return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })
    }

    // Verify OS belongs to customer
    const os = await prisma.serviceOrder.findFirst({
      where: {
        id: params.id,
        company_id: portalUser.company_id,
        customer_id: portalUser.customer_id,
        deleted_at: null,
      },
      select: { id: true },
    })

    if (!os) {
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

    // Generate signed URLs for private bucket
    const supabase = createAdminClient()
    const photosWithUrls = await Promise.all(
      photos.map(async (photo) => {
        if (photo.url.startsWith('http')) {
          return photo // Already a full URL (legacy)
        }
        const { data } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(photo.url, 3600) // 1 hour expiry

        return {
          ...photo,
          signed_url: data?.signedUrl || null,
        }
      })
    )

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

    // Verify OS belongs to customer
    const os = await prisma.serviceOrder.findFirst({
      where: {
        id: params.id,
        company_id: portalUser.company_id,
        customer_id: portalUser.customer_id,
        deleted_at: null,
      },
      select: { id: true, os_number: true },
    })

    if (!os) {
      return NextResponse.json({ error: 'OS nao encontrada' }, { status: 404 })
    }

    // Check current photo count
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

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Tipo de arquivo nao permitido. Use JPEG, PNG, WebP ou PDF.' },
        { status: 400 }
      )
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'Arquivo muito grande. Maximo 10MB.' },
        { status: 400 }
      )
    }

    // Sanitize filename
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const safeName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`
    const storagePath = `${portalUser.company_id}/${portalUser.customer_id}/${params.id}/${safeName}`

    // Upload to Supabase Storage
    const supabase = createAdminClient()
    const buffer = Buffer.from(await file.arrayBuffer())

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: false,
      })

    if (uploadError) {
      console.error('[Portal Upload Error]', uploadError)
      // If bucket doesn't exist, create it
      if (uploadError.message?.includes('not found') || uploadError.message?.includes('Bucket')) {
        await supabase.storage.createBucket(BUCKET, {
          public: false,
          fileSizeLimit: MAX_FILE_SIZE,
        })
        // Retry upload
        const { error: retryError } = await supabase.storage
          .from(BUCKET)
          .upload(storagePath, buffer, {
            contentType: file.type,
            upsert: false,
          })
        if (retryError) {
          console.error('[Portal Upload Retry Error]', retryError)
          return NextResponse.json({ error: 'Erro ao enviar arquivo' }, { status: 500 })
        }
      } else {
        return NextResponse.json({ error: 'Erro ao enviar arquivo' }, { status: 500 })
      }
    }

    // Save to database
    const photo = await prisma.serviceOrderPhoto.create({
      data: {
        company_id: portalUser.company_id,
        service_order_id: params.id,
        url: storagePath,
        label,
        uploaded_by: portalUser.customer_id,
      },
    })

    // Generate signed URL for response
    const { data: signedData } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, 3600)

    return NextResponse.json({
      data: {
        id: photo.id,
        url: storagePath,
        signed_url: signedData?.signedUrl || null,
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

    // Verify photo belongs to customer's OS
    const photo = await prisma.serviceOrderPhoto.findFirst({
      where: {
        id: photo_id,
        service_order_id: params.id,
        company_id: portalUser.company_id,
        uploaded_by: portalUser.customer_id, // Can only delete own uploads
      },
    })

    if (!photo) {
      return NextResponse.json({ error: 'Foto nao encontrada' }, { status: 404 })
    }

    // Delete from Storage
    if (photo.url && !photo.url.startsWith('http')) {
      const supabase = createAdminClient()
      await supabase.storage.from(BUCKET).remove([photo.url])
    }

    // Delete from DB
    await prisma.serviceOrderPhoto.delete({ where: { id: photo_id } })

    return NextResponse.json({ data: { success: true } })
  } catch (err) {
    console.error('[Portal Photos DELETE Error]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
