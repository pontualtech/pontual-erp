import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

const DEFAULT_PAYMENT_REMINDER_TEMPLATE = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:600px;margin:0 auto;padding:20px;background:#f5f5f5;">
<div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;">
  <div style="background:#1e40af;padding:24px;text-align:center;">
    <h2 style="margin:0;color:#fff;font-size:20px;">{{company_name}}</h2>
  </div>
  <div style="padding:24px;">
    <p style="margin:0 0 16px;font-size:15px;color:#1e293b;">
      Prezado(a) <strong>{{customer_name}}</strong>,
    </p>
    <p style="margin:0 0 20px;color:#475569;">
      Informamos que existe um valor pendente em seu cadastro. Segue o detalhamento abaixo:
    </p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <thead>
        <tr style="background:#f8fafc;">
          <th style="padding:10px 12px;text-align:left;font-size:12px;color:#64748b;border-bottom:2px solid #e2e8f0;">Descrição</th>
          <th style="padding:10px 12px;text-align:right;font-size:12px;color:#64748b;border-bottom:2px solid #e2e8f0;">Valor</th>
          <th style="padding:10px 12px;text-align:center;font-size:12px;color:#64748b;border-bottom:2px solid #e2e8f0;">Vencimento</th>
          <th style="padding:10px 12px;text-align:center;font-size:12px;color:#64748b;border-bottom:2px solid #e2e8f0;">Dias em atraso</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;">{{description}}</td>
          <td style="padding:10px 12px;text-align:right;font-weight:600;color:#dc2626;border-bottom:1px solid #f1f5f9;">{{amount}}</td>
          <td style="padding:10px 12px;text-align:center;border-bottom:1px solid #f1f5f9;">{{due_date}}</td>
          <td style="padding:10px 12px;text-align:center;font-weight:600;color:#dc2626;border-bottom:1px solid #f1f5f9;">{{days_overdue}} dias</td>
        </tr>
      </tbody>
    </table>
    <div style="text-align:center;margin:24px 0;">
      <a href="{{payment_link}}" style="display:inline-block;background:#16a34a;color:#fff;font-size:16px;font-weight:600;padding:14px 40px;border-radius:8px;text-decoration:none;">
        Pagar Agora
      </a>
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#94a3b8;text-align:center;">
      Caso já tenha efetuado o pagamento, por favor desconsidere esta mensagem.
    </p>
  </div>
  <div style="background:#f8fafc;padding:16px;text-align:center;border-top:1px solid #e2e8f0;">
    <p style="margin:0;font-size:12px;color:#94a3b8;">
      {{company_name}} | Tel: {{company_phone}}<br>
      Em caso de dúvidas, entre em contato conosco.
    </p>
  </div>
</div>
</body>
</html>`

/**
 * POST - Preview do email renderizado (sem enviar)
 */
export async function POST(request: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await request.json().catch(() => ({}))
    const { template: customTemplate } = body as { template?: string }

    // Carregar template salvo ou usar o custom/default
    let htmlTemplate = customTemplate
    if (!htmlTemplate) {
      const msgTemplate = await prisma.messageTemplate.findFirst({
        where: { company_id: user.companyId, trigger: 'payment_reminder', channel: 'email', is_active: true },
      })
      htmlTemplate = msgTemplate?.template || DEFAULT_PAYMENT_REMINDER_TEMPLATE
    }

    // Carregar settings da empresa
    const allSettings = await prisma.setting.findMany({ where: { company_id: user.companyId } })
    const settingsMap: Record<string, string> = {}
    for (const s of allSettings) settingsMap[s.key] = s.value

    const company = await prisma.company.findFirst({ where: { id: user.companyId } })

    // Dados de exemplo para preview
    const vars: Record<string, string> = {
      customer_name: 'João da Silva (exemplo)',
      amount: 'R$ 350,00',
      due_date: '15/03/2026',
      days_overdue: '14',
      payment_link: '#preview',
      company_name: company?.name || 'Empresa',
      company_phone: settingsMap['company.phone'] || settingsMap['telefone'] || '(11) 99999-9999',
      description: 'Manutenção de Impressora HP LaserJet',
    }

    let result_html = htmlTemplate
    for (const [key, value] of Object.entries(vars)) {
      result_html = result_html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '—')
    }

    return success({ html: result_html, template: htmlTemplate })
  } catch (err) {
    return handleError(err)
  }
}
