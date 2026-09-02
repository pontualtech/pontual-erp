// POST /api/internal/cron/conciliacao-pendente-alert
//
// Controle DETECTIVE semanal (auditoria 01/09 — golpe do comprovante OS 61857):
// recebiveis DECLARADOS recebidos na entrega/balcao mas nunca conciliados no
// extrato ficam "pagos" sem lastro. Este cron varre os que estao ha >=7 dias
// sem conciliar e manda um email pro financeiro de cada empresa, separando:
//   - ALTO risco: PIX/boleto/transferencia sem pagamento confirmado no provedor
//     (formato do golpe — comprovante em PDF nao garante que o dinheiro caiu).
//   - A conferir: cartao/dinheiro (conciliar Rede / bater caixa).
// Assim ninguem mais acumula 90 dias de declaracao nao conferida.
//
// Agendado via Coolify scheduled task (semanal, 2a-feira 08h BRT). Auth: x-internal-key.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { sendCompanyEmail } from '@/lib/send-email'
import { logAudit } from '@/lib/audit'
import { receivableAlertLevel } from '@/lib/finance/conciliacao-alert'

const MIN_AGE_DAYS = 7

// Financeiro/gerencia por empresa (ecossistemas independentes).
const COMPANY_CONTACTS: Record<string, string> = {
  'pontualtech-001': 'karlao@outlook.com',
  '86c829cf-32ed-4e40-80cd-59ce4178aa1a': 'karlao@outlook.com',
}
const COMPANY_NAME: Record<string, string> = {
  'pontualtech-001': 'PontualTech',
  '86c829cf-32ed-4e40-80cd-59ce4178aa1a': 'Imprimitech',
}

const fmtBRL = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export async function POST(req: NextRequest) {
  const expectedKey = process.env.INTERNAL_API_KEY
  if (!expectedKey) {
    console.error('[conciliacao-alert] INTERNAL_API_KEY nao configurado')
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
  }
  if (req.headers.get('x-internal-key') !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const cutoff = new Date(now.getTime() - MIN_AGE_DAYS * 86_400_000)

  const ars = await prisma.accountReceivable.findMany({
    where: {
      status: { in: ['RECEBIDO', 'LIQUIDADO', 'PAGO'] },
      reconciled: false,
      deleted_at: null,
      received_amount: { gt: 0 },
      created_at: { lt: cutoff },
    },
    select: {
      id: true, company_id: true, service_order_id: true, description: true,
      received_amount: true, payment_method: true, status: true, reconciled: true,
      deleted_at: true, created_at: true,
      service_orders: { select: { os_number: true } },
      customers: { select: { legal_name: true } },
    },
    orderBy: { created_at: 'asc' },
    take: 1000,
  })

  // Lastro: OS com pagamento confirmado no provedor (Asaas).
  const osIds = [...new Set(ars.map(a => a.service_order_id).filter((x): x is string => !!x))]
  const paidSet = new Set<string>()
  if (osIds.length) {
    const paid = await prisma.payment.findMany({
      where: { service_order_id: { in: osIds }, status: { in: ['CONFIRMED', 'RECEIVED'] } },
      select: { service_order_id: true },
    })
    for (const p of paid) if (p.service_order_id) paidSet.add(p.service_order_id)
  }

  const byCompany = new Map<string, { high: typeof ars; watch: typeof ars }>()
  for (const ar of ars) {
    const lvl = receivableAlertLevel(
      ar,
      ar.service_order_id ? paidSet.has(ar.service_order_id) : false,
      now.getTime(),
      MIN_AGE_DAYS,
    )
    if (lvl === 'skip') continue
    const g = byCompany.get(ar.company_id) || { high: [] as typeof ars, watch: [] as typeof ars }
    g[lvl].push(ar)
    byCompany.set(ar.company_id, g)
  }

  const rowsHtml = (arr: typeof ars) =>
    arr.map(a =>
      `<tr><td style="padding:4px 8px">OS #${a.service_orders?.os_number ?? '?'}</td>` +
      `<td style="padding:4px 8px">${a.customers?.legal_name ?? '-'}</td>` +
      `<td style="padding:4px 8px;text-align:right"><strong>${fmtBRL(a.received_amount || 0)}</strong></td>` +
      `<td style="padding:4px 8px">${a.payment_method ?? '?'}</td>` +
      `<td style="padding:4px 8px;text-align:right">${Math.round((now.getTime() - (a.created_at?.getTime() ?? now.getTime())) / 86_400_000)}d</td></tr>`
    ).join('')

  let emailsSent = 0
  const summary: any[] = []

  for (const [companyId, g] of byCompany) {
    const totalHigh = g.high.reduce((s, a) => s + (a.received_amount || 0), 0)
    const totalWatch = g.watch.reduce((s, a) => s + (a.received_amount || 0), 0)
    summary.push({ company: companyId, high: g.high.length, watch: g.watch.length, total_high: totalHigh, total_watch: totalWatch })

    const to = COMPANY_CONTACTS[companyId]
    if (!to || g.high.length + g.watch.length === 0) continue

    const empresa = COMPANY_NAME[companyId] || companyId
    const highTable = g.high.length
      ? `<p style="color:#b91c1c;font-weight:bold;margin:16px 0 4px">🔴 RISCO — PIX/boleto declarado sem confirmacao no provedor (conferir extrato com prioridade — formato do golpe do comprovante): ${fmtBRL(totalHigh)}</p>
         <table style="border-collapse:collapse;font-size:13px"><thead><tr style="background:#fee2e2"><th style="padding:4px 8px;text-align:left">OS</th><th style="padding:4px 8px;text-align:left">Cliente</th><th style="padding:4px 8px;text-align:right">Valor</th><th style="padding:4px 8px;text-align:left">Metodo</th><th style="padding:4px 8px;text-align:right">Idade</th></tr></thead><tbody>${rowsHtml(g.high)}</tbody></table>`
      : ''
    const watchTable = g.watch.length
      ? `<p style="color:#b45309;font-weight:bold;margin:16px 0 4px">🟡 A CONFERIR — cartao/dinheiro declarado sem conciliar (conciliar Rede / bater caixa): ${fmtBRL(totalWatch)}</p>
         <table style="border-collapse:collapse;font-size:13px"><thead><tr style="background:#fef3c7"><th style="padding:4px 8px;text-align:left">OS</th><th style="padding:4px 8px;text-align:left">Cliente</th><th style="padding:4px 8px;text-align:right">Valor</th><th style="padding:4px 8px;text-align:left">Metodo</th><th style="padding:4px 8px;text-align:right">Idade</th></tr></thead><tbody>${rowsHtml(g.watch)}</tbody></table>`
      : ''
    const html = `<p>Relatorio automatico semanal de conciliacao — <strong>${empresa}</strong>.</p>
      <p>Recebimentos marcados como recebidos ha 7 dias ou mais e ainda <strong>nao conciliados no extrato</strong>. Confira cada um no banco/maquininha e marque como conciliado no financeiro.</p>
      ${highTable}${watchTable}
      <p style="margin-top:16px;font-size:12px;color:#555">Enquanto nao conciliado, o portal do cliente mostra "Pagamento registrado — em conferencia" (nao afirma "quitado"). Este alerta some quando os itens forem conciliados.</p>`

    try {
      await sendCompanyEmail(companyId, to, `[Conciliacao ${empresa}] ${g.high.length} de risco + ${g.watch.length} a conferir (${fmtBRL(totalHigh + totalWatch)})`, html)
      emailsSent++
    } catch (err) {
      console.error(`[conciliacao-alert] email falhou (${companyId}):`, err instanceof Error ? err.message : err)
    }
    logAudit({
      companyId,
      userId: 'system:cron:conciliacao-alert',
      module: 'financeiro',
      action: 'conciliacao_pendente_alert',
      entityId: companyId,
      newValue: { high: g.high.length, watch: g.watch.length, total_high: totalHigh, total_watch: totalWatch },
    })
  }

  return NextResponse.json({ data: { checked: ars.length, companies: summary, emails_sent: emailsSent } })
}
