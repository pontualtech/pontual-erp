import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { classificar, planejarLinha } from '@/lib/financeiro/livro'
import { garantirCategoriasERegras } from '@/lib/financeiro/livro-categorias'

/**
 * Livro-razão — lançamento das linhas do extrato bancário.
 * Cada linha vira (no máximo) uma Transaction categorizada; o saldo do ERP passa a refletir o banco.
 * Idempotente por (conta, bank_ref = chave). `simular: true` não grava nada.
 */
const DATA = /^\d{4}-\d{2}-\d{2}$/

const bodySchema = z.object({
  account_id: z.string().min(1),
  corte: z.string().regex(DATA),
  simular: z.boolean().optional(),
  linhas: z.array(
    z.object({
      chave: z.string().min(1),
      data: z.string().regex(DATA),
      descricao: z.string(),
      valor_centavos: z.number().int(),
      contraparte: z.string().optional(),
      links: z.array(z.string()).optional(),
    }),
  ),
})

interface Resultado {
  chave: string
  acao: 'IGNORAR' | 'LIGAR' | 'CRIAR'
  valor_centavos?: number
  categoria?: string | null
  transaction_id?: string
}

export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = bodySchema.parse(await req.json())
    const simular = body.simular === true

    const account = await prisma.account.findFirst({
      where: { id: body.account_id, company_id: user.companyId },
    })
    if (!account) return error('Conta não encontrada', 404)

    // Categorias (nome → id): na simulação só lê, sem criar nada.
    let categorias: Map<string, string>
    if (simular) {
      const existentes = await prisma.category.findMany({
        where: { company_id: user.companyId },
        select: { id: true, name: true },
      })
      categorias = new Map(existentes.map((c) => [c.name, c.id]))
    } else {
      categorias = await prisma.$transaction((tx) => garantirCategoriasERegras(tx, user.companyId))
    }
    const nomePorId = new Map([...categorias].map(([nome, id]) => [id, nome]))

    const regras = await prisma.classificationRule.findMany({
      where: { company_id: user.companyId, active: true },
    })

    const resultados: Resultado[] = []
    let saldoSimulado = account.current_balance ?? 0

    for (const linha of body.linhas) {
      const jaLancada =
        (await prisma.transaction.findFirst({
          where: { company_id: user.companyId, account_id: body.account_id, bank_ref: linha.chave },
          select: { id: true },
        })) !== null

      const links = linha.links ?? []
      const creditos =
        links.length > 0
          ? await prisma.transaction.findMany({
              where: { company_id: user.companyId, account_id: body.account_id, bank_ref: { in: links } },
              select: { bank_ref: true, amount: true },
            })
          : []
      const creditosExistentes = creditos.map((c) => ({ bank_ref: c.bank_ref as string, amount: c.amount }))

      const plano = planejarLinha(linha, body.corte, jaLancada, creditosExistentes)

      if (plano.acao === 'IGNORAR') {
        resultados.push({ chave: linha.chave, acao: 'IGNORAR' })
        continue
      }

      if (plano.acao === 'LIGAR') {
        if (!simular) {
          await prisma.transaction.updateMany({
            where: { company_id: user.companyId, account_id: body.account_id, bank_ref: { in: plano.refs } },
            data: { reconciled: true },
          })
        }
        resultados.push({ chave: linha.chave, acao: 'LIGAR' })
        continue
      }

      // CRIAR
      const valor = plano.valor_centavos
      const { category_id: porRegra } = classificar(linha, regras, body.account_id)
      const nomeFallback = plano.identificar || valor > 0 ? 'Receita a identificar' : 'A classificar'
      const categoriaId = porRegra ?? categorias.get(nomeFallback) ?? null
      const categoriaNome = porRegra ? (nomePorId.get(porRegra) ?? null) : nomeFallback

      if (simular) {
        saldoSimulado += valor
        resultados.push({ chave: linha.chave, acao: 'CRIAR', valor_centavos: valor, categoria: categoriaNome })
        continue
      }

      const criada = await prisma.$transaction(async (tx) => {
        const t = await tx.transaction.create({
          data: {
            company_id: user.companyId,
            account_id: body.account_id,
            transaction_type: valor > 0 ? 'CREDIT' : 'DEBIT',
            amount: Math.abs(valor),
            description: linha.descricao,
            transaction_date: new Date(linha.data + 'T00:00:00.000Z'),
            bank_ref: linha.chave,
            origin: 'BANCO',
            source_text: linha.descricao,
            counterparty: linha.contraparte ?? null,
            category_id: categoriaId,
            reconciled: true,
          },
        })
        await tx.account.update({
          where: { id: body.account_id },
          data: { current_balance: { increment: valor }, updated_at: new Date() },
        })
        if (plano.refs_ligadas.length > 0) {
          await tx.transaction.updateMany({
            where: {
              company_id: user.companyId,
              account_id: body.account_id,
              bank_ref: { in: plano.refs_ligadas },
            },
            data: { reconciled: true },
          })
        }
        return t
      })
      resultados.push({
        chave: linha.chave,
        acao: 'CRIAR',
        valor_centavos: valor,
        categoria: categoriaNome,
        transaction_id: criada.id,
      })
    }

    let saldo: number
    if (simular) {
      saldo = saldoSimulado
    } else {
      const atual = await prisma.account.findFirst({
        where: { id: body.account_id, company_id: user.companyId },
        select: { current_balance: true },
      })
      saldo = atual?.current_balance ?? 0
    }

    return success({ resultados, saldo_erp_centavos: saldo })
  } catch (e) {
    if (e instanceof z.ZodError) {
      return error(e.errors[0]?.message || 'Dados inválidos', 422)
    }
    return handleError(e)
  }
}
