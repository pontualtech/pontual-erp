import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { getDefaultColetaConcluidaTemplate } from '@/lib/email-templates/coleta-concluida'

export async function GET() {
  try {
    const result = await requirePermission('config', 'view')
    if (result instanceof NextResponse) return result
    const user = result
    const [html, subject] = await Promise.all([
      prisma.setting.findFirst({ where: { company_id: user.companyId, key: 'email_templates.coleta_concluida.html' } }),
      prisma.setting.findFirst({ where: { company_id: user.companyId, key: 'email_templates.coleta_concluida.subject' } }),
    ])
    const def = getDefaultColetaConcluidaTemplate()
    return success({
      html: html?.value || def.html,
      subject: subject?.value || def.subject,
      is_custom: !!(html?.value || subject?.value),
      default: def,
    })
  } catch (err) { return handleError(err) }
}

export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof NextResponse) return result
    const user = result
    const body = await req.json().catch(() => ({}))
    const html = typeof body.html === 'string' ? body.html : null
    const subject = typeof body.subject === 'string' ? body.subject : null
    if (html === null && subject === null) return error('Informe html ou subject', 400)
    const ops = []
    if (html !== null) {
      ops.push(prisma.setting.upsert({
        where: { company_id_key: { company_id: user.companyId, key: 'email_templates.coleta_concluida.html' } },
        create: { company_id: user.companyId, key: 'email_templates.coleta_concluida.html', value: html, type: 'html' },
        update: { value: html, updated_at: new Date() },
      }))
    }
    if (subject !== null) {
      ops.push(prisma.setting.upsert({
        where: { company_id_key: { company_id: user.companyId, key: 'email_templates.coleta_concluida.subject' } },
        create: { company_id: user.companyId, key: 'email_templates.coleta_concluida.subject', value: subject, type: 'string' },
        update: { value: subject, updated_at: new Date() },
      }))
    }
    await prisma.$transaction(ops)
    return success({ saved: true })
  } catch (err) { return handleError(err) }
}

export async function DELETE() {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof NextResponse) return result
    const user = result
    await prisma.setting.deleteMany({
      where: {
        company_id: user.companyId,
        key: { in: ['email_templates.coleta_concluida.html', 'email_templates.coleta_concluida.subject'] },
      },
    })
    return success({ reset: true })
  } catch (err) { return handleError(err) }
}
