import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma, type Prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { classificar, planejarLinha, escolherOrfao, limitesJanelaOrfao, creditoUsavelParaVinculo } from '@/lib/financeiro/livro'
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
  refs?: string[]
  origem?: 'orfao'
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
    const ajuste = await prisma.transaction.findFirst({
      where: {
        company_id: user.companyId,
        account_id: body.account_id,
        bank_ref: `AJUSTE:${body.account_id}:${body.corte}`,
      },
      select: { id: true, created_at: true },
    })
    if (!simular && !ajuste) return error('ajuste de caixa ainda não lançado para esta conta/corte', 409)
    // Órfãos só valem se criados DEPOIS do ajuste (os anteriores já foram absorvidos por ele).
    // Simulação sem ajuste: "agora" — se o ajuste rodasse agora, tudo o que existe seria absorvido.
    const limiteOrfao = ajuste?.created_at ?? new Date()

    // Créditos citados em `links` por qualquer linha do pedido: não podem ser tomados como órfãos.
    const linksDoPedido = new Set(body.linhas.flatMap((l) => l.links ?? []))

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
      // Já lançada: criada com esta chave OU usada para ligar a um órfão (LIGADA:<chave>).
      const jaLancada =
        (await db.transaction.findFirst({
          where: {
            company_id: user.companyId,
            account_id: body.account_id,
            OR: [{ bank_ref: linha.chave }, { source_text: `LIGADA:${linha.chave}` }],
          },
          select: { id: true },
        })) !== null
      const links = linha.links ?? []
      const creditos =
        links.length > 0
          ? await db.transaction.findMany({
              where: { company_id: user.companyId, account_id: body.account_id, bank_ref: { in: links } },
              select: { bank_ref: true, amount: true, source_text: true, created_at: true },
            })
          : []
      // Ausente: já tomado por OUTRA linha (LIGADA:<outra chave>) ou criado até o ajuste (já absorvido por ele).
      const creditosExistentes = creditos
        .filter((c) => creditoUsavelParaVinculo(c, linha.chave, limiteOrfao))
        .map((c) => ({ bank_ref: c.bank_ref as string, amount: c.amount }))
      return planejarLinha(linha, body.corte, jaLancada, creditosExistentes)
    }

    // Procura crédito/débito já existente ("órfão") que corresponda à linha, na mesma empresa e conta.
    // Só vale p/ linha sem vínculo nenhum; ignora órfãos já usados neste pedido.
    const buscarOrfao = async (db: Pick<typeof prisma, 'transaction'>, linha: Linha, usados: Set<string>) => {
      const { de, ate } = limitesJanelaOrfao(linha.data)
      const candidatos = await db.transaction.findMany({
        where: {
          company_id: user.companyId,
          account_id: body.account_id,
          origin: null,
          source_text: null,
          transaction_type: linha.valor_centavos > 0 ? 'CREDIT' : 'DEBIT',
          amount: Math.abs(linha.valor_centavos),
          transaction_date: { gte: de, lte: ate },
          created_at: { gt: limiteOrfao },
        },
        orderBy: [{ transaction_date: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
        select: { id: true, amount: true, transaction_type: true, transaction_date: true, bank_ref: true },
      })
      return escolherOrfao(
        linha,
        candidatos
          .filter((c) => !usados.has(c.id) && !(c.bank_ref !== null && linksDoPedido.has(c.bank_ref)))
          .map((c) => ({
            id: c.id,
            amount: c.amount,
            transaction_type: c.transaction_type as 'CREDIT' | 'DEBIT',
            transaction_date: c.transaction_date.toISOString().slice(0, 10),
          })),
      )
    }

    // Liga transações existentes à linha do banco: marca LIGADA:<chave>, leva a data do banco (data real do
    // caixa; a baixa da AR gera o crédito no dia da baixa) e, se a data mudou, guarda a data da baixa na descrição.
    const ligarComDataBanco = async (
      tx: Pick<typeof prisma, 'transaction'>,
      where: Prisma.TransactionWhereInput,
      extra: { reconciled?: boolean },
      chave: string,
      dataBanco: Date,
    ) => {
      const alvos = await tx.transaction.findMany({ where, select: { id: true, transaction_date: true, description: true } })
      const novaData = dataBanco.toISOString().slice(0, 10)
      let count = 0
      for (const t of alvos) {
        const antes = t.transaction_date.toISOString().slice(0, 10)
        const r = await tx.transaction.updateMany({
          where: { ...where, id: t.id },
          data: {
            ...extra,
            source_text: `LIGADA:${chave}`,
            transaction_date: dataBanco,
            ...(antes !== novaData ? { description: `${t.description ?? ''} (baixa no ERP em ${antes})` } : {}),
          },
        })
        count += r.count
      }
      return count
    }

    // Marca as transações ligadas por esta linha (sem sobrescrever quem já foi ligada por outra).
    const marcarLigadas = (tx: Pick<typeof prisma, 'transaction'>, refs: string[], chave: string, dataBanco: Date) =>
      ligarComDataBanco(
        tx,
        { company_id: user.companyId, account_id: body.account_id, bank_ref: { in: refs }, source_text: null },
        {},
        chave,
        dataBanco,
      )

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
    const orfaosUsados = new Set<string>()
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
        if (plano.acao === 'CRIAR' && plano.refs_ligadas.length === 0) {
          const orfaoId = await buscarOrfao(prisma, linha, orfaosUsados)
          if (orfaoId) {
            orfaosUsados.add(orfaoId)
            resultados.push({ chave: linha.chave, acao: 'LIGAR', refs: [orfaoId], origem: 'orfao' })
            continue
          }
        }
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
          resultados.push({ chave: linha.chave, acao: 'LIGAR', refs: plano.refs })
        }
        continue
      }

      const res = await prisma.$transaction(async (tx): Promise<Resultado> => {
        // Primeira instrução: trava a conta. Chamadas concorrentes esperam aqui e já enxergam a linha gravada.
        await tx.$queryRaw`SELECT current_balance FROM accounts WHERE id = ${body.account_id} AND company_id = ${user.companyId} FOR UPDATE`
        const plano = await planejar(tx, linha)
        const dataBanco = new Date(linha.data + 'T00:00:00.000Z')

        if (plano.acao === 'IGNORAR') return { chave: linha.chave, acao: 'IGNORAR', motivo: plano.motivo }

        if (plano.acao === 'LIGAR') {
          await tx.transaction.updateMany({
            where: { company_id: user.companyId, account_id: body.account_id, bank_ref: { in: plano.refs } },
            data: { reconciled: true },
          })
          await marcarLigadas(tx, plano.refs, linha.chave, dataBanco)
          return { chave: linha.chave, acao: 'LIGAR', refs: plano.refs }
        }

        // Linha sem vínculo: tenta ligar a um órfão existente antes de criar (não conta o dinheiro 2x).
        if (plano.refs_ligadas.length === 0) {
          const orfaoId = await buscarOrfao(tx, linha, orfaosUsados)
          if (orfaoId) {
            orfaosUsados.add(orfaoId)
            const ligadas = await ligarComDataBanco(
              tx,
              { id: orfaoId, company_id: user.companyId, account_id: body.account_id, source_text: null },
              { reconciled: true },
              linha.chave,
              dataBanco,
            )
            if (ligadas === 1) return { chave: linha.chave, acao: 'LIGAR', refs: [orfaoId], origem: 'orfao' }
            // Alguém levou o órfão antes: segue para CRIAR.
          }
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
            transaction_date: dataBanco,
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
          await marcarLigadas(tx, plano.refs_ligadas, linha.chave, dataBanco)
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
