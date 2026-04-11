import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { authenticateBot } from '../_lib/auth'
import { botSuccess, botError } from '../_lib/response'
import { writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/app/uploads'

/**
 * POST /api/bot/upload-foto
 * Upload photo for an OS. Accepts multipart form data.
 * Fields: os_id (required), file (required), label (optional)
 * Auth: X-Bot-Key header ou ?key= query param
 */
export async function POST(req: NextRequest) {
  try {
    const auth = authenticateBot(req)
    if (auth instanceof NextResponse) return auth

    const formData = await req.formData()
    const osId = formData.get('os_id') as string
    const file = formData.get('file') as File | null
    const label = (formData.get('label') as string) || 'cliente'

    if (!osId) return botError('Campo "os_id" obrigatorio')
    if (!file) return botError('Campo "file" obrigatorio')
    if (!ALLOWED_TYPES.includes(file.type)) return botError('Tipo nao permitido. Use JPEG, PNG ou WebP.')
    if (file.size > MAX_FILE_SIZE) return botError('Arquivo muito grande. Maximo 10MB.')

    const os = await prisma.serviceOrder.findFirst({
      where: { id: osId, company_id: auth.companyId, deleted_at: null },
      select: { id: true, os_number: true },
    })
    if (!os) return botError('OS nao encontrada', 404)

    const EXT_MAP: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
    const ext = EXT_MAP[file.type] ?? 'jpg'
    const safeName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`
    const relPath = path.join(auth.companyId, osId, safeName)
    const fullPath = path.join(UPLOAD_DIR, relPath)

    const dir = path.dirname(fullPath)
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    await writeFile(fullPath, buffer)

    const photo = await prisma.serviceOrderPhoto.create({
      data: {
        company_id: auth.companyId,
        service_order_id: osId,
        url: relPath,
        label,
        uploaded_by: 'site-pontualtech',
      },
    })

    console.log(`[Bot upload-foto] OS #${os.os_number} — foto ${safeName} (${(file.size / 1024).toFixed(0)}KB)`)

    return botSuccess({
      foto_id: photo.id,
      os_numero: os.os_number,
      arquivo: safeName,
      tamanho: file.size,
    })
  } catch (err: any) {
    console.error('[Bot upload-foto]', err.message)
    return botError('Erro interno', 500)
  }
}
