import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { calcularAjuste } from '@/lib/financeiro/livro-ajuste'
import { garantirCategoriasERegras } from '@/lib/financeiro/livro-categorias'

/**
 * Livro-razão — ajuste de caixa único por conta no corte: zera o passado para o saldo do ERP
 * ficar EXATAMENTE igual ao saldo real do banco. Idempotente por bank_ref 'AJUSTE:conta:data'.
 */
const bodySchema = z.object({
  account_id: z.string().min(1),
  saldo_real_centavos: z.number().int(),
  data_corte: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  simular: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = bodySchema.parse(await req.json())

    const account = await prisma.account.findFirst({
      where: { id: body.account_id, company_id: user.companyId },
    })
    if (!account) return error('Conta não encontrada', 404)

    const bankRef = `AJUSTE:${body.account_id}:${body.data_corte}`
    const existente = await prisma.transaction.findFirst({
      where: { company_id: user.companyId, account_id: body.account_id, bank_ref: bankRef },
    })
    if (existente) {
      return success({
        saldo_erp_atual: account.current_balance ?? 0,
        ajuste_centavos: existente.transaction_type === 'CREDIT' ? existente.amount : -existente.amount,
        transaction_id: existente.id,
      })
    }

    const saldoErp = account.current_balance ?? 0
    const { tipo, amount } = calcularAjuste(body.saldo_real_centavos, saldoErp)
    const ajuste = tipo === 'DEBIT' ? -amount : amount

    if (tipo === null || body.simular === true) {
      return success({ saldo_erp_atual: saldoErp, ajuste_centavos: ajuste })
    }

    const criada = await prisma.$transaction(async (tx) => {
      const categorias = await garantirCategoriasERegras(tx, user.companyId)
      const t = await tx.transaction.create({
        data: {
          company_id: user.companyId,
          account_id: body.account_id,
          transaction_type: tipo,
          amount,
          description: `Ajuste de caixa — saldo real do fim de ${body.data_corte}`,
          transaction_date: new Date(body.data_corte + 'T00:00:00.000Z'),
          bank_ref: bankRef,
          origin: 'AJUSTE',
          category_id: categorias.get('Ajuste de caixa') ?? null,
          reconciled: true,
        },
      })
      // Grava o saldo exatamente igual ao real (em vez de incrementar), para terminar sem diferença.
      await tx.account.update({
        where: { id: body.account_id },
        data: { current_balance: body.saldo_real_centavos, updated_at: new Date() },
      })
      return t
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'livro.ajuste',
      entityId: criada.id,
      oldValue: { current_balance: saldoErp },
      newValue: { account_id: body.account_id, saldo_real_centavos: body.saldo_real_centavos, ajuste_centavos: ajuste },
    })

    return success({ saldo_erp_atual: saldoErp, ajuste_centavos: ajuste, transaction_id: criada.id })
  } catch (e) {
    if (e instanceof z.ZodError) {
      return error(e.errors[0]?.message || 'Dados inválidos', 422)
    }
    return handleError(e)
  }
}
