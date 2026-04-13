import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

// POST: upload company logo (stores as base64 data URL)
export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const formData = await req.formData()
    const file = formData.get('logo') as File | null
    if (!file) return error('Arquivo é obrigatório', 400)

    const ext = file.name.toLowerCase().split('.').pop()
    if (!['png', 'jpg', 'jpeg', 'webp'].includes(ext || '')) {
      return error('Formato inválido. Envie PNG, JPG ou WebP.', 400)
    }

    if (file.size > 500 * 1024) {
      return error('Arquivo muito grande. Máximo 500KB.', 400)
    }

    const buffer = await file.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    const mimeMap: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      webp: 'image/webp',
    }
    const mime = mimeMap[ext || 'png'] || 'image/png'
    const dataUrl = `data:${mime};base64,${base64}`

    // Save to settings
    await prisma.setting.upsert({
      where: { company_id_key: { company_id: user.companyId, key: 'aparencia.logo_url' } },
      update: { value: dataUrl },
      create: { company_id: user.companyId, key: 'aparencia.logo_url', value: dataUrl, type: 'string' },
    })

    return success({ url: dataUrl, filename: file.name, size: file.size })
  } catch (err) {
    return handleError(err)
  }
}
