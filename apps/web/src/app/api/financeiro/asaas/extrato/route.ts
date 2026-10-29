import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { getPaymentProviderForAccount } from '@/lib/payments/factory'
import { AsaasProvider } from '@/lib/payments/adapters/asaas'
import { resumirExtratoAsaas } from '@/lib/payments/asaas-extrato'

/**
 * GET /api/financeiro/asaas/extrato?from=AAAA-MM-DD&to=AAAA-MM-DD
 *
 * Extrato e saldo REAIS da conta Asaas (consultados pelo servidor — a API do Asaas só aceita o IP dele),
 * cada lançamento ligado à cobrança/OS do ERP, e o saldo da conta ASSAS no ERP para comparar.
 * Usado pela conciliação da manhã (Karlão 29/10: "quero saber tudo que entra de dinheiro na empresa").
 * Permission: financeiro.view. Não devolve credenciais.
 */
export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const sp = req.nextUrl.searchParams
    const hoje = new Date().toISOString().slice(0, 10)
    const from = sp.get('from') || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
    const to = sp.get('to') || hoje
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return error('from/to devem ser AAAA-MM-DD', 400)

    const contas = await prisma.account.findMany({
      where: { company_id: user.companyId, is_active: true },
      select: { id: true, name: true, current_balance: true, provider_config: true },
    })
    const conta = contas.find(c => String((c.provider_config as Record<string, unknown> | null)?.provider || '').toLowerCase() === 'asaas')
    if (!conta) return error('Nenhuma conta Asaas configurada', 404)

    const provider = await getPaymentProviderForAccount(conta.id, user.companyId)
    if (!(provider instanceof AsaasProvider)) return error('Conta Asaas sem credencial válida', 422)

    const [saldo, lancamentos] = await Promise.all([provider.getBalance(), provider.listFinancialTransactions(from, to)])

    const ids = [...new Set(lancamentos.map(l => l.paymentId).filter(Boolean) as string[])]
    const pagamentos = ids.length
      ? await prisma.payment.findMany({
          where: { company_id: user.companyId, external_id: { in: ids } },
          select: { external_id: true, service_order_id: true, receivable_id: true },
        })
      : []
    const [ars, oss] = await Promise.all([
      prisma.accountReceivable.findMany({
        where: { company_id: user.companyId, id: { in: pagamentos.map(p => p.receivable_id).filter(Boolean) as string[] } },
        select: { id: true, status: true, reconciled: true },
      }),
      prisma.serviceOrder.findMany({
        where: { company_id: user.companyId, id: { in: pagamentos.map(p => p.service_order_id).filter(Boolean) as string[] } },
        select: { id: true, os_number: true },
      }),
    ])
    const arPorId = new Map(ars.map(a => [a.id, a]))
    const osPorId = new Map(oss.map(o => [o.id, o.os_number]))

    return success({
      conta: conta.name,
      periodo: { from, to },
      saldo_asaas_centavos: Number.isFinite(saldo) ? Math.round(saldo * 100) : null,
      saldo_erp_centavos: conta.current_balance,
      lancamentos: resumirExtratoAsaas(lancamentos, pagamentos.map(p => ({
        external_id: p.external_id!,
        os_number: (p.service_order_id && osPorId.get(p.service_order_id)) || null,
        ar_status: (p.receivable_id && arPorId.get(p.receivable_id)?.status) || null,
        ar_reconciled: p.receivable_id ? (arPorId.get(p.receivable_id)?.reconciled ?? null) : null,
      }))),
    })
  } catch (err) {
    return handleError(err)
  }
}
