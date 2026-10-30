import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { resumoRealizado } from '@/lib/financeiro/livro-resumo'

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/

// GET ?from=AAAA-MM-DD&to=AAAA-MM-DD&account_id= — realizado no banco por categoria (contas do livro por padrão)
export async function GET(request: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const sp = new URL(request.url).searchParams
    // Padrão: mês corrente
    const hoje = new Date()
    const ym = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`
    const ultimoDia = String(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate()).padStart(2, '0')
    const from = sp.get('from') ?? `${ym}-01`
    const to = sp.get('to') ?? `${ym}-${ultimoDia}`
    if (!DATA_RE.test(from) || !DATA_RE.test(to) || isNaN(Date.parse(from)) || isNaN(Date.parse(to))) {
      return error('Período inválido (use AAAA-MM-DD)', 400)
    }

    // Contas do livro = contas da empresa com ao menos uma linha de banco (origin BANCO)
    const contasLivro = await prisma.account.findMany({
      where: { company_id: user.companyId, transactions: { some: { origin: 'BANCO' } } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
    const accountId = sp.get('account_id')
    const contas = accountId ? contasLivro.filter((c) => c.id === accountId) : contasLivro
    if (accountId && contas.length === 0) return error('Conta não encontrada', 400)

    const txs = await prisma.transaction.findMany({
      where: {
        company_id: user.companyId,
        account_id: { in: contas.map((c) => c.id) },
        transaction_date: { gte: new Date(from), lte: new Date(to) },
      },
      select: { transaction_type: true, amount: true, bank_ref: true, categories: { select: { name: true } } },
    })

    const resumo = resumoRealizado(
      txs.map((t) => ({ transaction_type: t.transaction_type, amount: t.amount, bank_ref: t.bank_ref, categoria: t.categories?.name ?? null })),
    )
    return success({ periodo: { from, to }, contas: contas.map((c) => ({ id: c.id, nome: c.name })), ...resumo })
  } catch (err) {
    return handleError(err)
  }
}
