import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

// GET: certificate status (never returns the actual cert data)
export async function GET() {
  try {
    const result = await requirePermission('config', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const config = await prisma.fiscalConfig.findUnique({
      where: { company_id: user.companyId },
    })

    if (!config) return success({ installed: false })

    const settings = (config.settings as any) || {}
    const hasCert = !!settings.certificate_base64

    let certInfo: any = { installed: false }
    if (hasCert) {
      certInfo = {
        installed: true,
        filename: settings.certificate_filename || 'certificado.pfx',
        uploaded_at: settings.certificate_uploaded_at || null,
        expires_at: settings.certificate_expires_at || null,
        subject: settings.certificate_subject || null,
        issuer: settings.certificate_issuer || null,
        has_password: !!config.certificate_password,
      }
    }

    return success(certInfo)
  } catch (err) {
    return handleError(err)
  }
}

// POST: upload certificate (.pfx/.p12)
export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const formData = await req.formData()
    const file = formData.get('certificate') as File | null
    const password = formData.get('password') as string | null

    if (!file) return error('Arquivo do certificado é obrigatório', 400)
    if (!password) return error('Senha do certificado é obrigatória', 400)

    const filename = file.name
    const ext = filename.toLowerCase().split('.').pop()
    if (!['pfx', 'p12'].includes(ext || '')) {
      return error('Formato inválido. Envie um arquivo .pfx ou .p12', 400)
    }

    // Read file as base64
    const buffer = await file.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')

    // Size check (max 50KB for A1 cert)
    if (buffer.byteLength > 50 * 1024) {
      return error('Certificado muito grande. Máximo 50KB para certificado A1.', 400)
    }

    // Get or create fiscal config
    let config = await prisma.fiscalConfig.findUnique({
      where: { company_id: user.companyId },
    })

    const currentSettings = (config?.settings as any) || {}
    const newSettings = {
      ...currentSettings,
      certificate_base64: base64,
      certificate_filename: filename,
      certificate_uploaded_at: new Date().toISOString(),
      certificate_size_bytes: buffer.byteLength,
    }

    if (config) {
      await prisma.fiscalConfig.update({
        where: { company_id: user.companyId },
        data: {
          certificate_password: password,
          settings: newSettings as any,
          updated_at: new Date(),
        },
      })
    } else {
      await prisma.fiscalConfig.create({
        data: {
          company_id: user.companyId,
          certificate_password: password,
          settings: newSettings as any,
        },
      })
    }

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'fiscal',
      action: 'certificate.install',
      newValue: { filename, size: buffer.byteLength },
    })

    return success({
      installed: true,
      filename,
      uploaded_at: newSettings.certificate_uploaded_at,
      size_bytes: buffer.byteLength,
    }, 201)
  } catch (err) {
    return handleError(err)
  }
}

// DELETE: remove certificate
export async function DELETE() {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const config = await prisma.fiscalConfig.findUnique({
      where: { company_id: user.companyId },
    })

    if (!config) return error('Configuração fiscal não encontrada', 404)

    const settings = (config.settings as any) || {}
    const hadCert = !!settings.certificate_base64

    // Remove cert data from settings
    delete settings.certificate_base64
    delete settings.certificate_filename
    delete settings.certificate_uploaded_at
    delete settings.certificate_size_bytes
    delete settings.certificate_expires_at
    delete settings.certificate_subject
    delete settings.certificate_issuer

    await prisma.fiscalConfig.update({
      where: { company_id: user.companyId },
      data: {
        certificate_password: null,
        settings: settings as any,
        updated_at: new Date(),
      },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'fiscal',
      action: 'certificate.uninstall',
    })

    return success({ removed: hadCert })
  } catch (err) {
    return handleError(err)
  }
}
