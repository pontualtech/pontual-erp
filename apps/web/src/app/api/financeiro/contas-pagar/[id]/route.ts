import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'
import { CONFLITO_BANCO, conflitoDeBanco, ContaAlterada, dinheiroDaAP, posAjuste, travarContas } from '@/lib/financeiro/livro-baixa-db'

type Params = { params: { id: string } }

// C11 fix 22/05: status NAO aceita PAGO via PATCH — PAGO so via /baixa.
const updatePayableSchema = z.object({
  supplier_id: z.string().nullable().optional(),
  description: z.string().min(1).optional(),
  notes: z.string().nullable().optional(),
  total_amount: z.number().int().positive().optional(),
  due_date: z.string().optional(),
  category_id: z.string().nullable().optional(),
  cost_center_id: z.string().nullable().optional(),
  account_id: z.string().nullable().optional(),
  payment_method: z.string().nullable().optional(),
  status: z.enum(['PENDENTE', 'CANCELADO']).optional(),
})

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const payable = await prisma.accountPayable.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      include: {
        // Wave SU-1: supplier_id agora aponta pra Supplier (não Customer)
        suppliers: { select: { id: true, name: true, document: true } },
        categories: { select: { id: true, name: true } },
        cost_centers: { select: { id: true, name: true } },
      },
    })

    if (!payable) return error('Conta a pagar nao encontrada', 404)

    // Get installments
    const installments = await prisma.installment.findMany({
      where: { parent_type: 'PAYABLE', parent_id: payable.id },
      orderBy: { installment_number: 'asc' },
    })

    // Get bank accounts, categories, cost centers for edit
    const [accounts, categories, costCenters] = await Promise.all([
      prisma.account.findMany({ where: { company_id: user.companyId, is_active: true }, select: { id: true, name: true, bank_name: true }, orderBy: { name: 'asc' } }),
      prisma.category.findMany({ where: { company_id: user.companyId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.costCenter.findMany({ where: { company_id: user.companyId, is_active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ])

    return success({ ...payable, installments, accounts, categories, cost_centers: costCenters })
  } catch (err) {
    return handleError(err)
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.accountPayable.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!existing) return error('Conta a pagar nao encontrada', 404)

    const body = await req.json()
    const data = updatePayableSchema.parse(body)

    // Wave AB-fix2 (2026-05-24): mesma estratégia do AR. AP em PAGO/CANCELADO
    // permite atualizar account_id e notes (admin conferindo extrato). Demais
    // campos bloqueados — preservam invariantes financeiros.
    const isTerminalStatus = ['PAGO', 'CANCELADO'].includes(existing.status || '')
    if (isTerminalStatus) {
      const allowedKeys = new Set(['account_id', 'notes'])
      const submittedKeys = Object.keys(data)
      const blockedKeys = submittedKeys.filter(k => !allowedKeys.has(k))
      if (blockedKeys.length > 0) {
        return error(
          `Conta em status ${existing.status} — só pode atualizar banco vinculado e notas. Campos não permitidos: ${blockedKeys.join(', ')}.`,
          400
        )
      }
    }

    // C15 fix 22/05: valida supplier_id pertence ao tenant
    // Wave SU-1 (2026-05-27): valida em prisma.supplier (não customer)
    if (data.supplier_id) {
      const supplier = await prisma.supplier.findFirst({
        where: { id: data.supplier_id, company_id: user.companyId },
        select: { id: true },
      })
      if (!supplier) return error('Fornecedor nao pertence a esta empresa', 403)
    }

    // A5 fix 22/05: invariante total_amount >= paid_amount.
    if (data.total_amount !== undefined) {
      const currentPaid = existing.paid_amount || 0
      if (data.total_amount < currentPaid) {
        return error(`Total (${data.total_amount}) menor que o ja pago (${currentPaid}). Estorne primeiro se quer reduzir.`, 400)
      }
    }

    // Bug #68 (audit 31/05 LOOP r10): PATCH status='PENDENTE' em AP PAGO com
    // paid_amount > 0 deixava inconsistente (status=PENDENTE mas paid_amount=50).
    // Antes só schema z.enum bloqueava 'PAGO', mas 'PENDENTE' passava.
    // Agora: pra reverter PAGO→PENDENTE, OBRIGA usar /estornar (que zera paid+gera transação).
    if (
      data.status === 'PENDENTE' &&
      existing.status === 'PAGO' &&
      (existing.paid_amount ?? 0) > 0
    ) {
      return error('Para reverter PAGO→PENDENTE use o botão Estornar (zera paid_amount e cria transação compensatória).', 400)
    }

    const updateData: any = { ...data, updated_at: new Date() }
    if (data.due_date) updateData.due_date = new Date(data.due_date)

    await prisma.accountPayable.updateMany({
      where: { id: params.id, company_id: user.companyId },
      data: updateData,
    })
    const payable = await prisma.accountPayable.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'payable.update',
      entityId: payable!.id,
      oldValue: { description: existing.description, total_amount: existing.total_amount, status: existing.status },
      newValue: data as any,
    })

    return success(payable!)
  } catch (err) {
    return handleError(err)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'delete')
    if (result instanceof NextResponse) return result
    const user = result

    // Onda 3 (E4 + round 1): com a linha travada (fecha a corrida com a baixa), recusa se os lançamentos próprios
    // (AP:id, :estorno) não se anulam (DEBIT AP:id − CREDIT :estorno ≠ 0) ou se há linha do banco ligada — ficariam órfãos.
    // Conta já estornada (líquido 0, sem linha ligada) pode ser excluída. O soft delete roda na mesma tx.
    // Onda 4 (§7): ordem única de travas — a conta bancária da conta (accounts) antes da própria conta. A leitura de fora
    // só diz QUAL conta travar; se ela mudou enquanto esperava a trava, desfaz (409 'conta alterada — repita').
    const lida = await prisma.accountPayable.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      select: { account_id: true },
    })
    if (!lida) return error('Conta a pagar nao encontrada', 404)
    const bloqueio = await prisma.$transaction(async (tx): Promise<{ status: 404 | 409; erro: string } | null> => {
      await travarContas(tx, user.companyId, [lida.account_id])
      await tx.$queryRaw`SELECT id FROM accounts_payable WHERE id = ${params.id} AND company_id = ${user.companyId} FOR UPDATE`
      // Onda 3 (G2): relida com a linha travada — é esta leitura que decide (não a de antes da trava).
      const existing = await tx.accountPayable.findFirst({
        where: { id: params.id, company_id: user.companyId, deleted_at: null },
      })
      if (!existing) return { status: 404, erro: 'Conta a pagar nao encontrada' }
      if (existing.account_id !== lida.account_id) return { status: 409, erro: new ContaAlterada().message }

      // Bug #8 (audit 31/05 Karlão): bloquear delete de AP pago pra evitar
      // saldo bancário órfão. Pagamento criou lançamento bancário que NÃO é
      // revertido pelo soft-delete do AP → diff silencioso no saldo.
      if (existing.status === 'PAGO' && (existing.paid_amount ?? 0) > 0) {
        return { status: 409, erro: 'Esta conta está paga. Estorne o pagamento antes de excluir (botão Estornar) para reverter o lançamento bancário.' }
      }

      const proprias = await tx.transaction.findMany({
        where: { company_id: user.companyId, bank_ref: { in: [`AP:${params.id}`, `AP:${params.id}:estorno`] } },
        select: { amount: true, transaction_type: true, bank_ref: true },
      })
      // Combinação inesperada (sinal 0) não dá para afirmar que se anula → bloqueia.
      const sinal = (t: { transaction_type: string; bank_ref: string | null }) =>
        t.transaction_type === 'DEBIT' && t.bank_ref === `AP:${params.id}` ? 1
          : t.transaction_type === 'CREDIT' && t.bank_ref === `AP:${params.id}:estorno` ? -1 : 0
      const PROPRIOS = { status: 409 as const, erro: 'há lançamentos financeiros desta conta; estorne antes de excluir' }
      if (proprias.some((t) => sinal(t) === 0)) return PROPRIOS
      // Fix 8 (F8-A/F8-B): a saída VIVA da AP (dinheiroDaAP: cada CREDIT :estorno anula, na sua conta, a saída criada até
      // ele — linha ligada ou DEBIT AP:<id>). DEBIT anterior ao ajuste de caixa não conta (o ajuste já o absorveu); CREDIT
      // :estorno sem DEBIT (estorno antigo de saída de outra origem, #15) não deixa nada vivo.
      const dinheiro = await dinheiroDaAP(tx, user.companyId, params.id)
      if ((await posAjuste(tx, user.companyId, dinheiro.nocionais)).some((t) => (t.vivo ?? t.amount) > 0)) return PROPRIOS
      if (dinheiro.linhas.length > 0) return { status: 409, erro: 'Há lançamento do banco ligado; estorne antes de excluir.' }
      await tx.accountPayable.updateMany({
        where: { id: params.id, company_id: user.companyId },
        data: { deleted_at: new Date() },
      })
      return null
    }, { maxWait: 10000, timeout: 20000 })
    if (bloqueio) return error(bloqueio.erro, bloqueio.status)

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'payable.delete',
      entityId: params.id,
    })

    return success({ deleted: true })
  } catch (err) {
    // Fix 2 (F2-D, m9): deadlock/timeout esperando a trava → 409 'repita' (a tx foi desfeita).
    if (conflitoDeBanco(err)) return error(CONFLITO_BANCO, 409)
    return handleError(err)
  }
}
