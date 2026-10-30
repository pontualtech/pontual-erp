import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { CATEGORIAS_FALLBACK } from '@/lib/financeiro/livro-baixa'
import { padraoDaLinha } from '@/lib/financeiro/livro-padrao'

/**
 * Livro-razão — classifica uma transação (troca a categoria) e, opcionalmente, cria uma regra
 * para que linhas parecidas já entrem classificadas nas próximas varreduras. A regra (nova ou já
 * existente) também corrige as outras linhas BANCO que ainda estão em categoria de fallback.
 * `pattern` ausente em criar_regra => derivado do texto da linha; `pattern: null` => sem regra.
 */
const bodySchema = z.object({
  category_id: z.string().min(1),
  simular: z.boolean().optional(),
  nota: z.string().optional(),
  criar_regra: z
    .object({
      pattern: z.string().nullable().optional(),
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
      select: { id: true, category_id: true, source_text: true, description: true },
    })
    if (!transacao) return error('Transação não encontrada', 404)

    const categoria = await prisma.category.findFirst({
      where: { id: body.category_id, company_id: user.companyId },
      select: { id: true, name: true },
    })
    if (!categoria) return error('Categoria inválida', 400)

    const textoLinha = transacao.source_text ?? transacao.description ?? ''
    const direction = body.criar_regra?.direction ?? null

    let pattern: string | null = null
    let motivoSemRegra: string | undefined
    if (body.criar_regra && (CATEGORIAS_FALLBACK as readonly string[]).includes(categoria.name)) {
      // "A classificar"/"Receita a identificar" é resposta provisória: vira regra só a categoria definitiva.
      motivoSemRegra = 'categoria provisória não vira regra'
    } else if (body.criar_regra) {
      const informado = body.criar_regra.pattern
      if (typeof informado === 'string') {
        pattern = informado.trim()
        // Padrão vazio casaria com TODAS as linhas.
        if (!pattern) return error('Padrão da regra não pode ser vazio', 400)
      } else if (informado === null) {
        motivoSemRegra = 'regra não solicitada'
      } else {
        pattern = padraoDaLinha(textoLinha)
        if (!pattern) motivoSemRegra = 'texto genérico, sem padrão seguro'
      }
    }

    const regraAtiva = (db: Pick<typeof prisma, 'classificationRule'>) =>
      db.classificationRule.findFirst({
        where: { company_id: user.companyId, active: true, pattern: pattern as string, direction },
        select: { id: true, category_id: true },
      })

    // Outras linhas BANCO ainda em categoria de fallback que casam com o padrão (e a direção).
    const filtroRetroativo = async (db: Pick<typeof prisma, 'category'>) => {
      const fallback = await db.category.findMany({
        where: { company_id: user.companyId, name: { in: [...CATEGORIAS_FALLBACK] } },
        select: { id: true },
      })
      return {
        company_id: user.companyId,
        origin: 'BANCO',
        id: { not: params.id },
        category_id: { in: fallback.map((c) => c.id) },
        source_text: { contains: pattern as string, mode: 'insensitive' as const },
        ...(direction === 'IN' ? { transaction_type: 'CREDIT' as const } : {}),
        ...(direction === 'OUT' ? { transaction_type: 'DEBIT' as const } : {}),
      }
    }

    const regraSaida = pattern ? { pattern, direction } : null

    // Simulação: valida tudo acima e só informa o que mudaria, sem gravar.
    if (body.simular === true) {
      const existente = pattern ? await regraAtiva(prisma) : null
      return success({
        id: params.id,
        category_id: body.category_id,
        regra: regraSaida,
        ...(motivoSemRegra ? { motivo_sem_regra: motivoSemRegra } : {}),
        regra_criada: !!pattern && !existente,
        regra_atualizada: !!existente && existente.category_id !== body.category_id,
        recategorizadas: pattern ? await prisma.transaction.count({ where: await filtroRetroativo(prisma) }) : 0,
        simulado: true,
      })
    }

    let regraCriada = false
    let regraAtualizada = false
    let categoriaAnteriorRegra: string | null = null
    let recategorizadas = 0
    await prisma.$transaction(async (tx) => {
      await tx.transaction.update({
        where: { id: params.id },
        data: {
          category_id: body.category_id,
          ...(body.nota ? { description: `${textoLinha} — ${body.nota}` } : {}),
        },
      })
      if (pattern) {
        const existente = await regraAtiva(tx)
        if (existente) {
          // A última resposta do dono vale: regra existente com outra categoria passa para a escolhida.
          if (existente.category_id !== body.category_id) {
            categoriaAnteriorRegra = existente.category_id
            await tx.classificationRule.update({
              where: { id: existente.id },
              data: { category_id: body.category_id },
            })
            regraAtualizada = true
          }
        } else {
          await tx.classificationRule.create({
            data: {
              company_id: user.companyId,
              pattern,
              direction,
              category_id: body.category_id,
              account_id: null,
              priority: 100,
              active: true,
            },
          })
          regraCriada = true
        }
        const r = await tx.transaction.updateMany({
          where: await filtroRetroativo(tx),
          data: { category_id: body.category_id },
        })
        recategorizadas = r.count
      }
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'livro.classificar',
      entityId: params.id,
      oldValue: { category_id: transacao.category_id, regra_category_id: categoriaAnteriorRegra },
      newValue: {
        category_id: body.category_id, regra_criada: regraCriada, regra_atualizada: regraAtualizada,
        regra_category_id: pattern ? body.category_id : null, pattern, recategorizadas,
      },
    })

    return success({
      id: params.id,
      category_id: body.category_id,
      regra: regraSaida,
      ...(motivoSemRegra ? { motivo_sem_regra: motivoSemRegra } : {}),
      regra_criada: regraCriada,
      regra_atualizada: regraAtualizada,
      recategorizadas,
    })
  } catch (e) {
    if (e instanceof z.ZodError) {
      return error(e.errors[0]?.message || 'Dados inválidos', 422)
    }
    return handleError(e)
  }
}
