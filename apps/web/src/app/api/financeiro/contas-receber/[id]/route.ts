import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'
import { CONFLITO_BANCO, conflitoDeBanco, ContaAlterada, dinheiroDaAR, posAjuste, travarContas } from '@/lib/financeiro/livro-baixa-db'
import { isReceivableSettled } from '@/lib/finance/receivable-status'

type Params = { params: { id: string } }

// C11 fix 22/05: status NAO aceita RECEBIDO via PATCH — RECEBIDO so via /baixa
// (que cria Transaction e atualiza saldo). PATCH com status=RECEBIDO seria
// bypass do fluxo financeiro (dinheiro "entra" sem Transaction).
const updateReceivableSchema = z.object({
  customer_id: z.string().nullable().optional(),
  service_order_id: z.string().nullable().optional(),
  description: z.string().min(1).optional(),
  notes: z.string().nullable().optional(),
  total_amount: z.number().int().positive().optional(),
  due_date: z.string().optional(),
  category_id: z.string().nullable().optional(),
  account_id: z.string().nullable().optional(),
  payment_method: z.string().nullable().optional(),
  // RECEBIDO/AGRUPADO so via endpoints dedicados (/baixa, /agrupar)
  status: z.enum(['PENDENTE', 'CANCELADO']).optional(),
})

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const receivable = await prisma.accountReceivable.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      include: {
        customers: { select: { id: true, legal_name: true, document_number: true } },
        categories: { select: { id: true, name: true } },
        service_orders: { select: { id: true, os_number: true, status_id: true } },
      },
    })

    if (!receivable) return error('Conta a receber nao encontrada', 404)

    // Get installments
    const installments = await prisma.installment.findMany({
      where: { parent_type: 'RECEIVABLE', parent_id: receivable.id },
      orderBy: { installment_number: 'asc' },
    })

    // Get bank accounts for reference
    const accounts = await prisma.account.findMany({
      where: { company_id: user.companyId, is_active: true },
      select: { id: true, name: true, bank_name: true },
      orderBy: { name: 'asc' },
    })

    // Get other pending receivables from the same customer (for unification)
    let otherPending: any[] = []
    if (receivable.customer_id && receivable.status === 'PENDENTE') {
      otherPending = await prisma.accountReceivable.findMany({
        where: {
          company_id: user.companyId,
          customer_id: receivable.customer_id,
          status: 'PENDENTE',
          deleted_at: null,
          grouped_into_id: null,
          id: { not: receivable.id },
        },
        select: {
          id: true, description: true, total_amount: true,
          due_date: true, payment_method: true,
          service_orders: { select: { id: true, os_number: true } },
        },
        orderBy: { due_date: 'asc' },
      })
    }

    // Get grouped receivables if this is a group parent
    let groupedItems: any[] = []
    if (receivable.group_id && !receivable.grouped_into_id) {
      groupedItems = await prisma.accountReceivable.findMany({
        where: {
          group_id: receivable.group_id,
          grouped_into_id: receivable.id,
          deleted_at: null,
        },
        select: {
          id: true, description: true, total_amount: true, due_date: true,
          service_orders: { select: { id: true, os_number: true } },
        },
        orderBy: { due_date: 'asc' },
      })
    }

    return success({
      ...receivable,
      installments,
      accounts,
      other_pending: otherPending,
      grouped_items: groupedItems,
    })
  } catch (err) {
    return handleError(err)
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const existing = await prisma.accountReceivable.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
    })
    if (!existing) return error('Conta a receber nao encontrada', 404)

    const body = await req.json()
    const data = updateReceivableSchema.parse(body)

    // Wave AB-fix2 (2026-05-24): guard granular. AR em RECEBIDO/CANCELADO/AGRUPADO
    // bloqueia mudança de campos financeiros (total_amount/status/description/etc)
    // PORÉM permite vincular/trocar account_id e ajustar notes — admin conferindo
    // no extrato pode precisar atribuir banco que faltava (caso OS 60227 Karlão
    // reportou 24/05). Esses 2 campos NÃO afetam invariantes financeiros.
    const isTerminalStatus = ['RECEBIDO', 'CANCELADO', 'AGRUPADO'].includes(existing.status || '')
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

    // A5 fix 22/05: invariante total_amount >= received_amount. Antes,
    // AR PENDENTE com received_amount>0 aceitava reduzir total → AR ficava
    // "super-pago" (received > total) sem disparar status RECEBIDO.
    if (data.total_amount !== undefined) {
      const currentReceived = existing.received_amount || 0
      if (data.total_amount < currentReceived) {
        return error(`Total (${data.total_amount}) menor que o ja recebido (${currentReceived}). Estorne primeiro se quer reduzir.`, 400)
      }
    }

    // Bug #68 (audit 31/05 LOOP r10): PATCH status='PENDENTE' em AR RECEBIDO com
    // received_amount > 0 deixava inconsistente. Forçar uso de /estornar.
    if (
      data.status === 'PENDENTE' &&
      isReceivableSettled(existing) &&
      (existing.received_amount ?? 0) > 0
    ) {
      return error('Para reverter RECEBIDO→PENDENTE use o botão Estornar (zera received_amount e cria transação compensatória).', 400)
    }

    const updateData: any = { ...data, updated_at: new Date() }
    if (data.due_date) updateData.due_date = new Date(data.due_date)

    await prisma.accountReceivable.updateMany({
      where: { id: params.id, company_id: user.companyId },
      data: updateData,
    })
    const receivable = await prisma.accountReceivable.findFirst({
      where: { id: params.id, company_id: user.companyId },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'receivable.update',
      entityId: receivable!.id,
      oldValue: { description: existing.description, total_amount: existing.total_amount, status: existing.status },
      newValue: data as any,
    })

    return success(receivable!)
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
    // (AR:id, :anticipation, :estorno) não se anulam (CREDIT AR:id/:anticipation − DEBIT :estorno ≠ 0) ou se há linha do banco ligada — ficariam órfãos.
    // Conta já estornada (líquido 0, sem linha ligada) pode ser excluída. O soft delete roda na mesma tx.
    // Onda 4 (§7): ordem única de travas — a conta bancária da conta (accounts) antes da própria conta. A leitura de fora
    // só diz QUAL conta travar; se ela mudou enquanto esperava a trava, desfaz (409 'conta alterada — repita').
    const lida = await prisma.accountReceivable.findFirst({
      where: { id: params.id, company_id: user.companyId, deleted_at: null },
      select: { account_id: true },
    })
    if (!lida) return error('Conta a receber nao encontrada', 404)
    const bloqueio = await prisma.$transaction(async (tx): Promise<{ status: 404 | 409; erro: string } | null> => {
      await travarContas(tx, user.companyId, [lida.account_id])
      await tx.$queryRaw`SELECT id FROM accounts_receivable WHERE id = ${params.id} AND company_id = ${user.companyId} FOR UPDATE`
      // Onda 3 (G2): relida com a linha travada — é esta leitura que decide (não a de antes da trava).
      const existing = await tx.accountReceivable.findFirst({
        where: { id: params.id, company_id: user.companyId, deleted_at: null },
      })
      if (!existing) return { status: 404, erro: 'Conta a receber nao encontrada' }
      if (existing.account_id !== lida.account_id) return { status: 409, erro: new ContaAlterada().message }

      // Bug #8 (audit 31/05 Karlão): bloquear delete de AR recebido (PAGO/RECEBIDO
      // são canônicos pra AR — projeto migrou 26/05 mas defensivo mantém ambos).
      // Recebimento criou lançamento bancário que NÃO é revertido pelo soft-delete.
      if (isReceivableSettled(existing) && (existing.received_amount ?? 0) > 0) {
        return { status: 409, erro: 'Esta conta está recebida. Estorne o recebimento antes de excluir (botão Estornar) para reverter o lançamento bancário.' }
      }

      // Onda 4 (fix 1.4, #15): o dinheiro desta conta inclui também os créditos dos Payments (pay_…, acquirer:…) e do
      // CNAB (cnab:<nossoNumero>); compensam o :estorno e a devolução do próprio Asaas (<pay>-refund / -chargeback).
      const dinheiro = await dinheiroDaAR(tx, user.companyId, existing)
      const refs = dinheiro.refs
      const devolucoesAsaas = refs.pagamentos
        .filter((p) => p.provider === 'asaas' && p.external_id)
        .flatMap((p) => [`${p.external_id}-refund`, `${p.external_id}-chargeback`])
      const creditos = new Set([refs.proprio, refs.antecipacao, ...refs.externos])
      const compensacoes = new Set([refs.estorno, ...devolucoesAsaas])
      const proprias = await tx.transaction.findMany({
        where: { company_id: user.companyId, bank_ref: { in: [...creditos, ...compensacoes] } },
        select: { amount: true, transaction_type: true, bank_ref: true },
      })
      // Combinação inesperada (sinal 0) não dá para afirmar que se anula → bloqueia.
      const sinal = (t: { transaction_type: string; bank_ref: string | null }) =>
        t.transaction_type === 'CREDIT' && creditos.has(t.bank_ref ?? '') ? 1
          : t.transaction_type === 'DEBIT' && compensacoes.has(t.bank_ref ?? '') ? -1 : 0
      const PROPRIOS = { status: 409 as const, erro: 'há lançamentos financeiros desta conta; estorne antes de excluir' }
      if (proprias.some((t) => sinal(t) === 0)) return PROPRIOS
      // Fix 8 (F8-A/F8-B): o dinheiro VIVO da conta (dinheiroDaAR: cada :estorno anula, na sua conta, o dinheiro criado até
      // ele — linhas ligadas, nocionais próprios e créditos externos; a devolução do Asaas anula o pagamento). Nocional
      // anterior ao ajuste de caixa não conta (o ajuste já o absorveu). Linha do banco ligada e não compensada (baixa ou
      // nocional convertido pelo livro, inclusive antecipação, adquirente, Asaas e CNAB) também impede.
      if ((await posAjuste(tx, user.companyId, dinheiro.nocionais)).some((t) => (t.vivo ?? t.amount) > 0)) return PROPRIOS
      if (dinheiro.linhas.length > 0) return { status: 409, erro: 'Há lançamento do banco ligado; estorne antes de excluir.' }
      await tx.accountReceivable.updateMany({
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
      action: 'receivable.delete',
      entityId: params.id,
    })

    return success({ deleted: true })
  } catch (err) {
    // Fix 2 (F2-D, m9): deadlock/timeout esperando a trava → 409 'repita' (a tx foi desfeita).
    if (conflitoDeBanco(err)) return error(CONFLITO_BANCO, 409)
    return handleError(err)
  }
}
