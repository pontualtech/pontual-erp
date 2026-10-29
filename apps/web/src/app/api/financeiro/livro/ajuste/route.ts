import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { calcularAjuste, dataValida } from '@/lib/financeiro/livro-ajuste'
import { garantirCategoriasERegras } from '@/lib/financeiro/livro-categorias'

/**
 * Livro-razão — ajuste de caixa único por conta no corte: zera o passado para o saldo do ERP
 * ficar EXATAMENTE igual ao saldo real do banco. Idempotente por bank_ref 'AJUSTE:conta:data'.
 * Se já não há diferença, grava um marcador de valor zero (abre o portão da varredura diária).
 */
const bodySchema = z.object({
  account_id: z.string().min(1),
  saldo_real_centavos: z.number().int(),
  data_corte: z.string().refine(dataValida, 'Data inválida (use AAAA-MM-DD)'),
  simular: z.boolean().optional(),
})

const assinado = (t: { transaction_type: string; amount: number }) =>
  t.transaction_type === 'CREDIT' ? t.amount : -t.amount

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

    // Simulação: somente leitura, sem trava nem transação.
    if (body.simular === true) {
      const existente = await prisma.transaction.findFirst({
        where: { company_id: user.companyId, account_id: body.account_id, bank_ref: bankRef },
      })
      const saldoErp = account.current_balance ?? 0
      if (existente) {
        return success({ saldo_erp_atual: saldoErp, ajuste_centavos: assinado(existente), transaction_id: existente.id })
      }
      const { tipo, amount } = calcularAjuste(body.saldo_real_centavos, saldoErp)
      return success({ saldo_erp_atual: saldoErp, ajuste_centavos: tipo === 'DEBIT' ? -amount : amount })
    }

    // Categorias antes de travar a conta (idempotente, transação curta própria).
    const categorias = await prisma.$transaction((tx) => garantirCategoriasERegras(tx, user.companyId))

    const feito = await prisma.$transaction(async (tx) => {
      // Trava a conta e lê o saldo já travado: webhooks concorrentes esperam; um ajuste concorrente vê o existente.
      const travada = await tx.$queryRaw<
        { current_balance: number | null }[]
      >`SELECT current_balance FROM accounts WHERE id = ${body.account_id} AND company_id = ${user.companyId} FOR UPDATE`
      const saldoErp = Number(travada[0]?.current_balance ?? 0)

      const existente = await tx.transaction.findFirst({
        where: { company_id: user.companyId, account_id: body.account_id, bank_ref: bankRef },
      })
      if (existente) return { existente, criada: null, saldoErp, ajuste: assinado(existente) }

      const { tipo, amount } = calcularAjuste(body.saldo_real_centavos, saldoErp)
      const criada = await tx.transaction.create({
        data: {
          company_id: user.companyId,
          account_id: body.account_id,
          transaction_type: tipo ?? 'CREDIT',
          amount,
          description:
            tipo === null
              ? `Ajuste de caixa — saldo conferido, sem diferença em ${body.data_corte}`
              : `Ajuste de caixa — saldo real do fim de ${body.data_corte}`,
          transaction_date: new Date(body.data_corte + 'T00:00:00.000Z'),
          bank_ref: bankRef,
          origin: 'AJUSTE',
          category_id: categorias.get('Ajuste de caixa') ?? null,
          reconciled: true,
        },
      })
      if (tipo !== null) {
        // Saldo travado + diferença = saldo real exato.
        await tx.account.update({
          where: { id: body.account_id },
          data: { current_balance: body.saldo_real_centavos, updated_at: new Date() },
        })
      }
      return { existente: null, criada, saldoErp, ajuste: tipo === 'DEBIT' ? -amount : amount }
    })

    if (feito.existente) {
      return success({ saldo_erp_atual: feito.saldoErp, ajuste_centavos: feito.ajuste, transaction_id: feito.existente.id })
    }

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'livro.ajuste',
      entityId: feito.criada!.id,
      oldValue: { current_balance: feito.saldoErp },
      newValue: {
        account_id: body.account_id,
        saldo_real_centavos: body.saldo_real_centavos,
        ajuste_centavos: feito.ajuste,
      },
    })

    return success({ saldo_erp_atual: feito.saldoErp, ajuste_centavos: feito.ajuste, transaction_id: feito.criada!.id })
  } catch (e) {
    if (e instanceof z.ZodError) {
      return error(e.errors[0]?.message || 'Dados inválidos', 422)
    }
    return handleError(e)
  }
}
