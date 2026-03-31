import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { sendEmail } from '@/lib/send-email'

type RouteParams = { params: { id: string } }

export async function POST(_req: NextRequest, { params }: RouteParams) {
  const auth = await requirePermission('fiscal', 'create')
  if (auth instanceof NextResponse) return auth
  const user = auth

  const invoice = await prisma.invoice.findFirst({
    where: { id: params.id, company_id: user.companyId, invoice_type: 'NFSE' },
    include: {
      customers: true,
      invoice_items: { take: 1 },
    },
  })

  if (!invoice) return NextResponse.json({ error: 'NFS-e nao encontrada' }, { status: 404 })
  if (!invoice.customers?.email) return NextResponse.json({ error: 'Cliente sem email' }, { status: 400 })
  if (invoice.status !== 'AUTHORIZED') return NextResponse.json({ error: 'NFS-e nao autorizada' }, { status: 400 })

  const company = await prisma.company.findUnique({ where: { id: user.companyId }, select: { name: true } })
  const valor = ((invoice.total_amount || 0) / 100).toFixed(2)
  const discriminacao = invoice.invoice_items?.[0]?.description || ''

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1a1a1a;">Nota Fiscal de Servico Eletronica</h2>
      <p>Prezado(a) <strong>${invoice.customers.legal_name}</strong>,</p>
      <p>Segue sua NFS-e referente ao servico prestado:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr style="background: #f8f9fa;">
          <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>NFS-e Numero</strong></td>
          <td style="padding: 10px; border: 1px solid #dee2e6;">${invoice.invoice_number}</td>
        </tr>
        <tr>
          <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>Codigo Verificacao</strong></td>
          <td style="padding: 10px; border: 1px solid #dee2e6;">${invoice.access_key || '-'}</td>
        </tr>
        <tr style="background: #f8f9fa;">
          <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>Valor</strong></td>
          <td style="padding: 10px; border: 1px solid #dee2e6;">R$ ${valor}</td>
        </tr>
      </table>
      ${discriminacao ? `<p><strong>Discriminacao:</strong></p><p style="background: #f8f9fa; padding: 12px; border-radius: 4px; font-size: 14px;">${discriminacao}</p>` : ''}
      ${invoice.danfe_url ? `<p style="margin-top: 20px;"><a href="${invoice.danfe_url}" style="display: inline-block; background: #7c3aed; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">Visualizar NFS-e</a></p>` : ''}
      <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;" />
      <p style="font-size: 12px; color: #888;">${company?.name || 'ERP'} — Nota Fiscal emitida eletronicamente pela Prefeitura de Sao Paulo</p>
    </div>
  `

  await sendEmail(
    invoice.customers.email,
    `NFS-e #${invoice.invoice_number} - ${company?.name || 'ERP'}`,
    html
  )

  return NextResponse.json({ success: true })
}
