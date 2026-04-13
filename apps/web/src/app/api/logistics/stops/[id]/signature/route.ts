import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { escapeHtml } from '@/lib/escape-html'

type Params = { params: { id: string } }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const stop = await prisma.logisticsStop.findFirst({
      where: { id: params.id, company_id: user.companyId },
      include: { route: true },
    })
    if (!stop) return error('Parada não encontrada', 404)

    const body = await req.json()
    const { signature } = body // base64 image

    if (!signature) return error('Assinatura é obrigatória (base64)', 400)

    // Decode base64
    const base64Data = signature.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')

    if (buffer.length > 2 * 1024 * 1024) {
      return error('Assinatura muito grande. Máximo: 2MB', 400)
    }

    // Save to filesystem
    const baseDir = existsSync('/app/uploads') ? '/app/uploads' : join(process.cwd(), 'uploads')
    const uploadsDir = join(baseDir, 'logistics', stop.route_id, params.id)
    if (!existsSync(uploadsDir)) {
      await mkdir(uploadsDir, { recursive: true })
    }

    const fileName = `signature_${Date.now()}.png`
    const filePath = join(uploadsDir, fileName)

    await writeFile(filePath, buffer)

    const publicUrl = `/api/logistics/stops/${params.id}/photo/${fileName}`

    // Update stop with signature_url
    const updated = await prisma.logisticsStop.update({
      where: { id: params.id },
      data: { signature_url: publicUrl },
    })

    // Generate PDF term if OS is linked
    let pdfUrl: string | null = null
    if (stop.os_id) {
      try {
        // Build a simple delivery/collection term as HTML, then save as reference
        const os = await prisma.serviceOrder.findFirst({
          where: { id: stop.os_id, company_id: user.companyId },
          include: { customers: true },
        })

        if (os) {
          const termType = stop.type === 'COLETA' ? 'COLETA' : 'ENTREGA'
          const termHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Termo de ${termType}</title>
<style>body{font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px}h1{text-align:center;font-size:18px}
.field{margin:8px 0}.label{font-weight:bold}.sig{margin-top:30px;text-align:center}
.sig img{max-width:300px;border:1px solid #ccc}</style></head>
<body>
<h1>Termo de ${termType}</h1>
<div class="field"><span class="label">OS:</span> ${String(os.os_number).padStart(4, '0')}</div>
<div class="field"><span class="label">Cliente:</span> ${escapeHtml(os.customers?.legal_name || 'N/A')}</div>
<div class="field"><span class="label">Equipamento:</span> ${escapeHtml([os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' '))}</div>
<div class="field"><span class="label">Endereço:</span> ${escapeHtml(stop.address)}</div>
<div class="field"><span class="label">Data/Hora:</span> ${new Date().toLocaleString('pt-BR')}</div>
<div class="field"><span class="label">Tipo:</span> ${termType}</div>
<div class="sig">
<p class="label">Assinatura:</p>
<img src="${publicUrl}" alt="Assinatura" />
</div>
</body></html>`

          const termFileName = `termo_${termType.toLowerCase()}_${Date.now()}.html`
          const termPath = join(uploadsDir, termFileName)
          await writeFile(termPath, termHtml)
          pdfUrl = `/api/logistics/stops/${params.id}/photo/${termFileName}`
        }
      } catch {
        // Best-effort: don't fail the signature just because term generation failed
      }
    }

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'logistics',
      action: 'upload_signature',
      entityId: params.id,
      newValue: { route_id: stop.route_id, os_id: stop.os_id },
    })

    return success({ signature_url: publicUrl, term_url: pdfUrl, stop: updated })
  } catch (err) {
    return handleError(err)
  }
}
