import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

type Params = { params: { id: string } }

const MAX_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp']

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const stop = await prisma.logisticsStop.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })
    if (!stop) return error('Parada não encontrada', 404)

    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) return error('Arquivo é obrigatório', 400)

    if (file.size > MAX_SIZE) {
      return error(`Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)}MB). Máximo: 5MB`, 400)
    }

    const ext = (file.name.split('.').pop() || '').toLowerCase()
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return error(`Tipo não permitido (.${ext}). Permitidos: ${ALLOWED_EXTENSIONS.join(', ')}`, 400)
    }

    // Save to filesystem
    const baseDir = existsSync('/app/uploads') ? '/app/uploads' : join(process.cwd(), 'uploads')
    const uploadsDir = join(baseDir, 'logistics', stop.route_id, params.id)
    if (!existsSync(uploadsDir)) {
      await mkdir(uploadsDir, { recursive: true })
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const fileName = `${Date.now()}_${safeName}`
    const filePath = join(uploadsDir, fileName)
    const buffer = Buffer.from(await file.arrayBuffer())

    await writeFile(filePath, buffer)

    // URL served via static path
    const publicUrl = `/api/logistics/stops/${params.id}/photo/${fileName}`

    // Add to stop.photo_urls array
    const currentPhotos = Array.isArray(stop.photo_urls) ? (stop.photo_urls as string[]) : []
    const updatedPhotos = [...currentPhotos, publicUrl]

    await prisma.logisticsStop.update({
      where: { id: params.id },
      data: { photo_urls: updatedPhotos },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'logistics',
      action: 'upload_stop_photo',
      entityId: params.id,
      newValue: { fileName: file.name, fileSize: file.size },
    })

    return success({ url: publicUrl, photo_urls: updatedPhotos }, 201)
  } catch (err) {
    return handleError(err)
  }
}
