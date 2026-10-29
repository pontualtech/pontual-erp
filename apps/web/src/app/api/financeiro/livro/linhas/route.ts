import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { classificar, planejarLinha } from '@/lib/financeiro/livro'
import { dataValida } from '@/lib/financeiro/livro-ajuste'
import { garantirCategoriasERegras } from '@/lib/financeiro/livro-categorias'

/**
 * Livro-razão — lançamento das linhas do extrato bancário.
 * Cada linha vira (no máximo) uma Transaction categorizada; o saldo do ERP passa a refletir o banco.
 * Idempotente por (conta, bank_ref = chave). `simular: true` não grava nada.
 *
 * Concorrência: no modo real, cada linha roda numa $transaction que começa travando a linha da conta
 * (FOR UPDATE); a checagem de duplicidade e as escritas acontecem dentro dessa mesma transação.
 */
const dataSchema = z.string().refine(dataValida, 'Data inválida (use AAAA-MM-DD)')

const bodySchema = z.object({
  account_id: z.string().min(1),
  corte: dataSchema,
  simular: z.boolean().optional(),
  linhas: z.array(
    z.object({
      chave: z.string().min(1),
      data: dataSchema,
      descricao: z.string(),
      valor_centavos: z.number().int(),
      contraparte: z.string().optional(),
      links: z.array(z.string()).optional(),
    }),
  ),
})

type Linha = z.infer<typeof bodySchema>['linhas'][number]

interface Resultado {
  chave: string
  acao: 'IGNORAR' | 'LIGAR' | 'CRIAR'
  motivo?: string
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

    // Real: o ajuste de caixa do corte precisa existir (é ele que zera o passado); simular não exige.
    if (!simular) {
      const ajuste = await prisma.transaction.findFirst({
        where: {
          company_id: user.companyId,
          account_id: body.account_id,
          bank_ref: `AJUSTE:${body.account_id}:${body.corte}`,
        },
        select: { id: true },
      })
      if (!ajuste) return error('ajuste de caixa ainda não lançado para esta conta/corte', 409)
    }

    // Categorias (nome → id): na simulação só lê; no real garante (idempotente) numa transação curta,
    // ANTES de travar a conta nas linhas.
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
      orderBy: [{ priority: 'asc' }, { created_at: 'asc' }],
    })

    // Decide a linha usando o cliente informado (prisma na simulação; tx travada no real).
    const planejar = async (db: Pick<typeof prisma, 'transaction'>, linha: Linha) => {
      const jaLancada =
        (await db.transaction.findFirst({
          where: { company_id: user.companyId, account_id: body.account_id, bank_ref: linha.chave },
          select: { id: true },
        })) !== null
      const links = linha.links ?? []
      const creditos =
        links.length > 0
          ? await db.transaction.findMany({
              where: { company_id: user.companyId, account_id: body.account_id, bank_ref: { in: links } },
              select: { bank_ref: true, amount: true },
            })
          : []
      const creditosExistentes = creditos.map((c) => ({ bank_ref: c.bank_ref as string, amount: c.amount }))
      return planejarLinha(linha, body.corte, jaLancada, creditosExistentes)
    }

    const categoriaDe = (linha: Linha, valor: number, identificar: boolean) => {
      const { category_id: porRegra } = classificar(linha, regras, body.account_id)
      const nomeFallback = identificar || valor > 0 ? 'Receita a identificar' : 'A classificar'
      return {
        id: porRegra ?? categorias.get(nomeFallback) ?? null,
        nome: porRegra ? (nomePorId.get(porRegra) ?? null) : nomeFallback,
      }
    }

    const resultados: Resultado[] = []
    const vistas = new Set<string>()
    let saldoSimulado = account.current_balance ?? 0

    for (const linha of body.linhas) {
      if (vistas.has(linha.chave)) {
        resultados.push({ chave: linha.chave, acao: 'IGNORAR', motivo: 'chave repetida no pedido' })
        continue
      }
      vistas.add(linha.chave)
      if (linha.valor_centavos === 0) {
        resultados.push({ chave: linha.chave, acao: 'IGNORAR', motivo: 'valor zero' })
        continue
      }

      if (simular) {
        const plano = await planejar(prisma, linha)
        if (plano.acao === 'CRIAR') {
          saldoSimulado += plano.valor_centavos
          const cat = categoriaDe(linha, plano.valor_centavos, plano.identificar)
          resultados.push({
            chave: linha.chave,
            acao: 'CRIAR',
            valor_centavos: plano.valor_centavos,
            categoria: cat.nome,
          })
        } else if (plano.acao === 'IGNORAR') {
          resultados.push({ chave: linha.chave, acao: 'IGNORAR', motivo: plano.motivo })
        } else {
          resultados.push({ chave: linha.chave, acao: 'LIGAR' })
        }
        continue
      }

      const res = await prisma.$transaction(async (tx): Promise<Resultado> => {
        // Primeira instrução: trava a conta. Chamadas concorrentes esperam aqui e já enxergam a linha gravada.
        await tx.$queryRaw`SELECT current_balance FROM accounts WHERE id = ${body.account_id} AND company_id = ${user.companyId} FOR UPDATE`
        const plano = await planejar(tx, linha)

        if (plano.acao === 'IGNORAR') return { chave: linha.chave, acao: 'IGNORAR', motivo: plano.motivo }

        if (plano.acao === 'LIGAR') {
          await tx.transaction.updateMany({
            where: { company_id: user.companyId, account_id: body.account_id, bank_ref: { in: plano.refs } },
            data: { reconciled: true },
          })
          return { chave: linha.chave, acao: 'LIGAR' }
        }

        const valor = plano.valor_centavos
        const cat = categoriaDe(linha, valor, plano.identificar)
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
            category_id: cat.id,
            reconciled: true,
          },
        })
        await tx.account.update({
          where: { id: body.account_id },
          data: { current_balance: { increment: valor }, updated_at: new Date() },
        })
        if (plano.refs_ligadas.length > 0) {
          await tx.transaction.updateMany({
            where: { company_id: user.companyId, account_id: body.account_id, bank_ref: { in: plano.refs_ligadas } },
            data: { reconciled: true },
          })
        }
        return { chave: linha.chave, acao: 'CRIAR', valor_centavos: valor, categoria: cat.nome, transaction_id: t.id }
      })
      resultados.push(res)
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
