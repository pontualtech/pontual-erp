import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

/**
 * Livro-razão — classifica uma transação (troca a categoria) e, opcionalmente, cria uma regra
 * para que linhas parecidas já entrem classificadas nas próximas varreduras.
 */
const bodySchema = z.object({
  category_id: z.string().min(1),
  criar_regra: z
    .object({
      pattern: z.string(),
      direction: z.enum(['IN', 'OUT']).nullable(),
    })
    .optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = bodySchema.parse(await req.json())

    const transacao = await prisma.transaction.findFirst({
      where: { id: params.id, company_id: user.companyId },
      select: { id: true, category_id: true },
    })
    if (!transacao) return error('Transação não encontrada', 404)

    const categoria = await prisma.category.findFirst({
      where: { id: body.category_id, company_id: user.companyId },
      select: { id: true },
    })
    if (!categoria) return error('Categoria inválida', 400)

    let pattern: string | null = null
    if (body.criar_regra) {
      pattern = body.criar_regra.pattern.trim()
      // Padrão vazio casaria com TODAS as linhas.
      if (!pattern) return error('Padrão da regra não pode ser vazio', 400)
    }

    let regraCriada = false
    await prisma.$transaction(async (tx) => {
      await tx.transaction.update({
        where: { id: params.id },
        data: { category_id: body.category_id },
      })
      if (body.criar_regra && pattern) {
        const jaExiste = await tx.classificationRule.findFirst({
          where: {
            company_id: user.companyId,
            active: true,
            pattern,
            direction: body.criar_regra.direction,
          },
          select: { id: true },
        })
        if (!jaExiste) {
          await tx.classificationRule.create({
            data: {
              company_id: user.companyId,
              pattern,
              direction: body.criar_regra.direction,
              category_id: body.category_id,
              account_id: null,
              priority: 100,
              active: true,
            },
          })
          regraCriada = true
        }
      }
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'livro.classificar',
      entityId: params.id,
      oldValue: { category_id: transacao.category_id },
      newValue: { category_id: body.category_id, regra_criada: regraCriada, pattern },
    })

    return success({ id: params.id, category_id: body.category_id, regra_criada: regraCriada })
  } catch (e) {
    if (e instanceof z.ZodError) {
      return error(e.errors[0]?.message || 'Dados inválidos', 422)
    }
    return handleError(e)
  }
}
