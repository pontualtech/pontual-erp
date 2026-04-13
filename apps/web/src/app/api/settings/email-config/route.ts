import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { clearEmailConfigCache, sendCompanyEmail } from '@/lib/send-email'

const EMAIL_KEYS = [
  'email.provider',      // 'resend' | 'smtp'
  'email.from_name',     // "Imprimi Tech"
  'email.from_address',  // "contato@imprimitech.com.br"
  'email.resend_api_key',// Resend API key (optional if using SMTP)
  'email.smtp_host',     // "smtp.hostinger.com"
  'email.smtp_port',     // "587"
  'email.smtp_user',     // "sac@imprimitech.com.br"
  'email.smtp_pass',     // password
  'email.smtp_secure',   // "true" for port 465, "false" for 587
]

// GET /api/settings/email-config — Load email configuration
export async function GET() {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const settings = await prisma.setting.findMany({
      where: { company_id: user.companyId, key: { in: EMAIL_KEYS } },
    })

    const config: Record<string, string> = {}
    for (const key of EMAIL_KEYS) {
      const s = settings.find(s => s.key === key)
      // Mask sensitive fields
      if (key === 'email.smtp_pass' && s?.value) {
        config[key] = '••••••••'
      } else if (key === 'email.resend_api_key' && s?.value) {
        config[key] = s.value.substring(0, 8) + '••••••••'
      } else {
        config[key] = s?.value || ''
      }
    }

    // Also check if global RESEND_API_KEY is configured
    config['_global_resend_configured'] = process.env.RESEND_API_KEY ? 'true' : 'false'

    return success(config)
  } catch (err) {
    return handleError(err)
  }
}

// PUT /api/settings/email-config — Save email configuration
export async function PUT(req: NextRequest) {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()

    // Validate provider
    const provider = body['email.provider']
    if (provider && provider !== 'resend' && provider !== 'smtp') {
      return error('Provider deve ser "resend" ou "smtp"')
    }

    // Save each setting
    for (const key of EMAIL_KEYS) {
      const value = body[key]
      if (value === undefined) continue
      // Don't overwrite password with mask
      if (key === 'email.smtp_pass' && value === '••••••••') continue
      if (key === 'email.resend_api_key' && value.includes('••••••••')) continue

      await prisma.setting.upsert({
        where: { company_id_key: { company_id: user.companyId, key } },
        create: { company_id: user.companyId, key, value: String(value), type: 'string' },
        update: { value: String(value) },
      })
    }

    // Clear cache so next email uses new config
    clearEmailConfigCache(user.companyId)

    return success({ message: 'Configurações de email salvas' })
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/settings/email-config — Test email sending
export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()
    const testTo = body.to || user.email

    // Clear cache to use latest config
    clearEmailConfigCache(user.companyId)

    const sent = await sendCompanyEmail(
      user.companyId,
      testTo,
      'Teste de Email — ERP',
      `<div style="font-family:sans-serif;padding:20px">
        <h2>Teste de Email</h2>
        <p>Este é um email de teste enviado pelo ERP.</p>
        <p>Se você recebeu este email, a configuração está funcionando corretamente!</p>
        <p style="color:#888;font-size:12px">Enviado em: ${new Date().toLocaleString('pt-BR')}</p>
      </div>`,
    )

    if (sent) {
      return success({ message: `Email de teste enviado para ${testTo}` })
    } else {
      return error('Falha ao enviar email de teste. Verifique as configurações.', 500)
    }
  } catch (err) {
    return handleError(err)
  }
}
