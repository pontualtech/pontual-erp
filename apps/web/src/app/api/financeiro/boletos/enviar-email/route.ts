import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { sendEmail } from '@/lib/send-email'

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission('fiscal', 'manage')
    if (auth instanceof NextResponse) return auth
    const user = auth

    const { receivable_id } = await req.json()
    if (!receivable_id) return NextResponse.json({ error: 'receivable_id obrigatorio' }, { status: 400 })

    const receivable = await prisma.accountReceivable.findFirst({
      where: { id: receivable_id, company_id: user.companyId },
      include: { customers: true },
    })

    if (!receivable) return NextResponse.json({ error: 'Conta nao encontrada' }, { status: 404 })
    if (!receivable.customers?.email) return NextResponse.json({ error: 'Cliente sem email cadastrado' }, { status: 400 })

    const company = await prisma.company.findUnique({
      where: { id: user.companyId },
      select: { name: true },
    })

    // Parsear metadata do boleto
    let boletoData: any = {}
    if (receivable.pix_code) {
      try { boletoData = JSON.parse(receivable.pix_code) } catch {}
    }

    const valor = (receivable.total_amount / 100).toFixed(2)
    const vencimento = new Date(receivable.due_date).toLocaleDateString('pt-BR')
    const linhaDigitavel = boletoData.digitableLine || boletoData.linhaDigitavel || ''
    const pixCode = boletoData.pixCode || ''
    const boletoUrl = receivable.boleto_url || ''

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1a1a1a;">Boleto - ${company?.name || 'ERP'}</h2>
        <p>Prezado(a) <strong>${receivable.customers.legal_name}</strong>,</p>
        <p>Segue o boleto referente a:</p>
        <p style="background: #f8f9fa; padding: 12px; border-radius: 4px;"><strong>${receivable.description}</strong></p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr style="background: #f8f9fa;">
            <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>Valor</strong></td>
            <td style="padding: 10px; border: 1px solid #dee2e6;">R$ ${valor}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>Vencimento</strong></td>
            <td style="padding: 10px; border: 1px solid #dee2e6;">${vencimento}</td>
          </tr>
          ${linhaDigitavel ? `<tr style="background: #f8f9fa;"><td style="padding: 10px; border: 1px solid #dee2e6;"><strong>Linha Digitavel</strong></td><td style="padding: 10px; border: 1px solid #dee2e6; font-family: monospace; font-size: 12px;">${linhaDigitavel}</td></tr>` : ''}
          ${pixCode ? `<tr><td style="padding: 10px; border: 1px solid #dee2e6;"><strong>PIX Copia e Cola</strong></td><td style="padding: 10px; border: 1px solid #dee2e6; font-family: monospace; font-size: 10px; word-break: break-all;">${pixCode}</td></tr>` : ''}
        </table>
        ${boletoUrl && !boletoUrl.startsWith('cnab://') ? `<p><a href="${boletoUrl}" style="display: inline-block; background: #ea580c; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">Visualizar Boleto PDF</a></p>` : ''}
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;" />
        <p style="font-size: 12px; color: #888;">${company?.name || 'ERP'} — Boleto gerado eletronicamente</p>
      </div>
    `

    const sent = await sendEmail(
      receivable.customers.email,
      `Boleto - R$ ${valor} - Venc. ${vencimento} - ${company?.name || 'ERP'}`,
      html
    )

    if (!sent) return NextResponse.json({ error: 'Falha ao enviar email (RESEND_API_KEY configurada?)' }, { status: 500 })

    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
