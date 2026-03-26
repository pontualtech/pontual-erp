import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { createClient } from '@/lib/supabase/server'

type Params = { params: { id: string } }

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const os = await prisma.serviceOrder.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      select: { id: true },
    })
    if (!os) return error('OS não encontrada', 404)

    const photos = await prisma.serviceOrderPhoto.findMany({
      where: { service_order_id: params.id, company_id: user.companyId },
      orderBy: { created_at: 'asc' },
    })

    return success(photos)
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const os = await prisma.serviceOrder.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!os) return error('OS não encontrada', 404)

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const label = (formData.get('label') as string) || 'before'
    const caption = formData.get('caption') as string | null

    if (!file) return error('Arquivo é obrigatório', 400)

    // Upload to Supabase Storage
    const supabase = createClient()
    const ext = file.name.split('.').pop() || 'jpg'
    const path = `os/${user.companyId}/${params.id}/${Date.now()}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const { data: uploadData, error: uploadErr } = await supabase.storage
      .from('os-photos')
      .upload(path, buffer, { contentType: file.type, upsert: false })

    if (uploadErr) return error(`Falha no upload: ${uploadErr.message}`, 500)

    const { data: urlData } = supabase.storage.from('os-photos').getPublicUrl(path)

    const photo = await prisma.serviceOrderPhoto.create({
      data: {
        company_id: user.companyId,
        service_order_id: params.id,
        url: urlData.publicUrl,
        label,
        uploaded_by: user.id,
      },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'os',
      action: 'upload_photo',
      entityId: params.id,
      newValue: { photoId: photo.id, label },
    })

    return success(photo, 201)
  } catch (err) {
    return handleError(err)
  }
}
