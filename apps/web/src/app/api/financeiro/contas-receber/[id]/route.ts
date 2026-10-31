import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'
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
    const bloqueio = await prisma.$transaction(async (tx): Promise<{ status: 404 | 409; erro: string } | null> => {
      await tx.$queryRaw`SELECT id FROM accounts_receivable WHERE id = ${params.id} AND company_id = ${user.companyId} FOR UPDATE`
      // Onda 3 (G2): relida com a linha travada — é esta leitura que decide (não a de antes da trava).
      const existing = await tx.accountReceivable.findFirst({
        where: { id: params.id, company_id: user.companyId, deleted_at: null },
      })
      if (!existing) return { status: 404, erro: 'Conta a receber nao encontrada' }

      // Bug #8 (audit 31/05 Karlão): bloquear delete de AR recebido (PAGO/RECEBIDO
      // são canônicos pra AR — projeto migrou 26/05 mas defensivo mantém ambos).
      // Recebimento criou lançamento bancário que NÃO é revertido pelo soft-delete.
      if (isReceivableSettled(existing) && (existing.received_amount ?? 0) > 0) {
        return { status: 409, erro: 'Esta conta está recebida. Estorne o recebimento antes de excluir (botão Estornar) para reverter o lançamento bancário.' }
      }

      const proprias = await tx.transaction.findMany({
        where: { company_id: user.companyId, bank_ref: { in: [`AR:${params.id}`, `AR:${params.id}:anticipation`, `AR:${params.id}:estorno`] } },
        select: { amount: true, transaction_type: true, bank_ref: true },
      })
      // Combinação inesperada (sinal 0) não dá para afirmar que se anula → bloqueia.
      const sinal = (t: { transaction_type: string; bank_ref: string | null }) =>
        t.transaction_type === 'CREDIT' && (t.bank_ref === `AR:${params.id}` || t.bank_ref === `AR:${params.id}:anticipation`) ? 1
          : t.transaction_type === 'DEBIT' && t.bank_ref === `AR:${params.id}:estorno` ? -1 : 0
      const liquido = proprias.reduce((soma, t) => soma + sinal(t) * t.amount, 0)
      if (proprias.some((t) => sinal(t) === 0) || liquido !== 0) return { status: 409, erro: 'há lançamentos financeiros desta conta; estorne antes de excluir' }
      const ligada = await tx.transaction.findFirst({
        where: { company_id: user.companyId, linked_ref: `AR:${params.id}` },
        select: { id: true },
      })
      if (ligada) return { status: 409, erro: 'Há lançamento do banco ligado; estorne antes de excluir.' }
      await tx.accountReceivable.updateMany({
        where: { id: params.id, company_id: user.companyId },
        data: { deleted_at: new Date() },
      })
      return null
    })
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
    return handleError(err)
  }
}
