import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { createClient } from '@/lib/supabase/server'

type Params = { params: { id: string } }

const MAX_SIZE = 2 * 1024 * 1024 // 2MB
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'gif', 'png', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'zip']
const ALLOWED_MIMES = [
  'image/jpeg', 'image/jpg', 'image/gif', 'image/png',
  'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'application/zip', 'application/x-zip-compressed',
]

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
    const label = (formData.get('label') as string) || ''
    const description = (formData.get('description') as string) || file?.name || ''

    if (!file) return error('Arquivo é obrigatório', 400)

    // Validar tamanho
    if (file.size > MAX_SIZE) {
      return error(`Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)}MB). Máximo: 2MB`, 400)
    }

    // Validar extensão
    const ext = (file.name.split('.').pop() || '').toLowerCase()
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return error(`Tipo de arquivo não permitido (.${ext}). Permitidos: ${ALLOWED_EXTENSIONS.join(', ')}`, 400)
    }

    // Validar MIME type
    if (!ALLOWED_MIMES.includes(file.type) && file.type !== 'application/octet-stream') {
      return error(`Tipo MIME não permitido (${file.type})`, 400)
    }

    // Upload to Supabase Storage
    const supabase = createClient()
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `os/${user.companyId}/${params.id}/${Date.now()}_${safeName}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const { error: uploadErr } = await supabase.storage
      .from('os-photos')
      .upload(path, buffer, { contentType: file.type, upsert: false })

    if (uploadErr) return error(`Falha no upload: ${uploadErr.message}`, 500)

    const { data: urlData } = supabase.storage.from('os-photos').getPublicUrl(path)

    const photo = await prisma.serviceOrderPhoto.create({
      data: {
        company_id: user.companyId,
        service_order_id: params.id,
        url: urlData.publicUrl,
        label: description || label,
        uploaded_by: user.id,
      },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'os',
      action: 'upload_file',
      entityId: params.id,
      newValue: { photoId: photo.id, fileName: file.name, fileSize: file.size, fileType: file.type },
    })

    return success(photo, 201)
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const { searchParams } = new URL(req.url)
    const photoId = searchParams.get('photoId')
    if (!photoId) return error('photoId obrigatório', 400)

    const photo = await prisma.serviceOrderPhoto.findFirst({
      where: { id: photoId, company_id: user.companyId, service_order_id: params.id },
    })
    if (!photo) return error('Arquivo não encontrado', 404)

    // Remover do Supabase Storage
    try {
      const supabase = createClient()
      const urlPath = new URL(photo.url).pathname
      const storagePath = urlPath.split('/os-photos/')[1]
      if (storagePath) {
        await supabase.storage.from('os-photos').remove([storagePath])
      }
    } catch {} // Best-effort

    await prisma.serviceOrderPhoto.delete({ where: { id: photoId } })

    return success({ deleted: true })
  } catch (err) {
    return handleError(err)
  }
}
