import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { sendEmail } from '@/lib/send-email'

/**
 * POST /api/financeiro/boletos/enviar-email
 * Envia boleto(s) por email para o(s) cliente(s)
 *
 * Body: { receivable_id: string } — envio unico
 *   ou: { ids: string[] }         — envio em lote
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission('fiscal', 'create')
    if (auth instanceof NextResponse) return auth
    const user = auth

    const body = await req.json()

    // Suportar envio unico ou em lote
    const ids: string[] = body.ids || (body.receivable_id ? [body.receivable_id] : [])
    if (ids.length === 0) {
      return NextResponse.json({ error: 'Informe receivable_id ou ids[]' }, { status: 400 })
    }

    const receivables = await prisma.accountReceivable.findMany({
      where: { id: { in: ids }, company_id: user.companyId },
      include: { customers: true },
    })

    if (receivables.length === 0) {
      return NextResponse.json({ error: 'Nenhuma conta encontrada' }, { status: 404 })
    }

    const company = await prisma.company.findUnique({
      where: { id: user.companyId },
      select: { name: true },
    })

    // Buscar config bancaria para incluir dados do cedente
    const settings = await prisma.setting.findMany({
      where: {
        company_id: user.companyId,
        key: { in: ['cnab.razao_social', 'cnab.cnpj', 'cnab.agencia', 'cnab.conta'] },
      },
    })
    const cfg: Record<string, string> = {}
    for (const s of settings) cfg[s.key] = s.value

    const companyName = company?.name || cfg['cnab.razao_social'] || 'ERP'
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://erp.pontualtech.work'

    let enviados = 0
    let erros = 0
    const detalhes: Array<{ id: string; email: string; status: string }> = []

    for (const receivable of receivables) {
      if (!receivable.customers?.email) {
        detalhes.push({ id: receivable.id, email: '', status: 'SEM_EMAIL' })
        erros++
        continue
      }

      let boletoData: any = {}
      if (receivable.pix_code) {
        try { boletoData = JSON.parse(receivable.pix_code) } catch {}
      }

      const valor = (receivable.total_amount / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
      const vencimento = new Date(receivable.due_date).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
      const linhaDigitavel = boletoData.digitableLine || boletoData.linhaDigitavel || ''
      const pixCode = boletoData.pixCode || ''
      const nossoNumero = boletoData.nossoNumero || ''
      const boletoUrl = receivable.boleto_url || ''
      const printUrl = `${appUrl}/boleto-print?ids=${receivable.id}`

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
          <div style="background: linear-gradient(135deg, #f97316, #ea580c); padding: 24px; border-radius: 12px 12px 0 0;">
            <h2 style="color: white; margin: 0; font-size: 20px;">${companyName}</h2>
            <p style="color: rgba(255,255,255,0.9); margin: 4px 0 0; font-size: 14px;">Cobranca</p>
          </div>

          <div style="background: #fff; border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 12px 12px;">
            <p style="font-size: 15px; margin: 0 0 16px;">
              Prezado(a) <strong>${receivable.customers.legal_name}</strong>,
            </p>
            <p style="font-size: 14px; color: #555; margin: 0 0 20px;">
              Segue abaixo os dados para pagamento:
            </p>

            <div style="background: #f8f9fa; border-radius: 8px; padding: 16px; margin: 0 0 20px;">
              <p style="margin: 0 0 4px; font-size: 13px; color: #666;">Descricao</p>
              <p style="margin: 0 0 16px; font-size: 15px; font-weight: 600;">${receivable.description}</p>

              <div style="display: flex; gap: 24px;">
                <div>
                  <p style="margin: 0 0 2px; font-size: 13px; color: #666;">Valor</p>
                  <p style="margin: 0; font-size: 22px; font-weight: 700; color: #059669;">R$ ${valor}</p>
                </div>
                <div>
                  <p style="margin: 0 0 2px; font-size: 13px; color: #666;">Vencimento</p>
                  <p style="margin: 0; font-size: 18px; font-weight: 600;">${vencimento}</p>
                </div>
              </div>

              ${nossoNumero ? `
                <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e5e7eb;">
                  <p style="margin: 0 0 2px; font-size: 13px; color: #666;">Nosso Numero</p>
                  <p style="margin: 0; font-family: monospace; font-size: 14px;">${nossoNumero}</p>
                </div>
              ` : ''}
            </div>

            ${linhaDigitavel ? `
              <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px; margin: 0 0 12px;">
                <p style="margin: 0 0 4px; font-size: 12px; color: #1e40af; font-weight: 600;">LINHA DIGITAVEL</p>
                <p style="margin: 0; font-family: 'Courier New', monospace; font-size: 13px; color: #1e3a5f; letter-spacing: 1px; word-break: break-all;">
                  ${linhaDigitavel}
                </p>
              </div>
            ` : ''}

            ${pixCode ? `
              <div style="background: #f5f3ff; border: 1px solid #c4b5fd; border-radius: 8px; padding: 12px; margin: 0 0 12px;">
                <p style="margin: 0 0 4px; font-size: 12px; color: #6d28d9; font-weight: 600;">PIX COPIA E COLA</p>
                <p style="margin: 0; font-family: monospace; font-size: 10px; color: #4c1d95; word-break: break-all;">
                  ${pixCode}
                </p>
              </div>
            ` : ''}

            <div style="margin-top: 20px; text-align: center;">
              ${boletoUrl && !boletoUrl.startsWith('cnab://') && !boletoUrl.startsWith('boleto://') ? `
                <a href="${boletoUrl}" style="display: inline-block; background: #ea580c; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px; margin-right: 8px;">
                  Baixar Boleto PDF
                </a>
              ` : ''}
              <a href="${printUrl}" style="display: inline-block; background: #1e40af; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px;">
                Visualizar Boleto
              </a>
            </div>

            <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
              <p style="font-size: 11px; color: #999; margin: 0; text-align: center;">
                ${companyName} — Boleto gerado eletronicamente via Banco Inter (077)
              </p>
            </div>
          </div>
        </div>
      `

      const sent = await sendEmail(
        receivable.customers.email,
        `Boleto R$ ${valor} — Venc. ${vencimento} — ${companyName}`,
        html
      )

      if (sent) {
        enviados++
        detalhes.push({ id: receivable.id, email: receivable.customers.email, status: 'ENVIADO' })
      } else {
        erros++
        detalhes.push({ id: receivable.id, email: receivable.customers.email, status: 'ERRO' })
      }
    }

    return NextResponse.json({
      success: enviados > 0,
      enviados,
      erros,
      total: receivables.length,
      detalhes,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
