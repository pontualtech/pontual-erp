import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { writeFile, mkdir, unlink } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

type Params = { params: { id: string } }

const MAX_SIZE = 2 * 1024 * 1024 // 2MB
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'gif', 'png', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'zip']

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
    const description = (formData.get('description') as string) || file?.name || ''

    if (!file) return error('Arquivo é obrigatório', 400)

    if (file.size > MAX_SIZE) {
      return error(`Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)}MB). Máximo: 2MB`, 400)
    }

    const ext = (file.name.split('.').pop() || '').toLowerCase()
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return error(`Tipo não permitido (.${ext}). Permitidos: ${ALLOWED_EXTENSIONS.join(', ')}`, 400)
    }

    // Salvar no filesystem (/app/uploads no Docker, ./uploads local)
    const baseDir = existsSync('/app/uploads') ? '/app/uploads' : join(process.cwd(), 'uploads')
    const uploadsDir = join(baseDir, 'os', params.id)
    if (!existsSync(uploadsDir)) {
      await mkdir(uploadsDir, { recursive: true })
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const fileName = `${Date.now()}_${safeName}`
    const filePath = join(uploadsDir, fileName)
    const buffer = Buffer.from(await file.arrayBuffer())

    await writeFile(filePath, buffer)

    // URL servida via API
    const publicUrl = `/api/os/${params.id}/photos/file/${fileName}`

    const photo = await prisma.serviceOrderPhoto.create({
      data: {
        company_id: user.companyId,
        service_order_id: params.id,
        url: publicUrl,
        label: description,
        uploaded_by: user.id,
      },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'os',
      action: 'upload_file',
      entityId: params.id,
      newValue: { photoId: photo.id, fileName: file.name, fileSize: file.size },
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

    const photoId = req.nextUrl.searchParams.get('photoId')
    if (!photoId) return error('photoId obrigatório', 400)

    const photo = await prisma.serviceOrderPhoto.findFirst({
      where: { id: photoId, company_id: user.companyId, service_order_id: params.id },
    })
    if (!photo) return error('Arquivo não encontrado', 404)

    // Remover do filesystem
    try {
      const fileName = photo.url.split('/').pop()
      if (fileName) {
        const baseDir = existsSync('/app/uploads') ? '/app/uploads' : join(process.cwd(), 'uploads')
        const filePath = join(baseDir, 'os', params.id, fileName)
        if (existsSync(filePath)) await unlink(filePath)
      }
    } catch {} // Best-effort

    await prisma.serviceOrderPhoto.delete({ where: { id: photoId } })

    return success({ deleted: true })
  } catch (err) {
    return handleError(err)
  }
}
