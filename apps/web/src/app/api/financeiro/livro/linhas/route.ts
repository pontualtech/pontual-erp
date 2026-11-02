import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { classificar, planejarLinha, escolherOrfao, limitesJanelaOrfao, creditoUsavelParaVinculo, refEstorno, compensado } from '@/lib/financeiro/livro'
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

    // Onda 4 (§2): tira os nocionais já compensados por um :estorno (par líquido 0 — não é dinheiro que entrou/saiu).
    const semCompensados = async <T extends { bank_ref: string | null; created_at: Date | null }>(
      db: Pick<typeof prisma, 'transaction'>,
      lista: T[],
    ): Promise<T[]> => {
      const refs = [...new Set(lista.map((c) => refEstorno(c.bank_ref)).filter((r): r is string => r !== null))]
      if (refs.length === 0) return lista
      const estornos = await db.transaction.findMany({
        where: { company_id: user.companyId, account_id: body.account_id, bank_ref: { in: refs } },
        select: { bank_ref: true, account_id: true, created_at: true },
      })
      return lista.filter((c) => {
        const ref = refEstorno(c.bank_ref)
        return !ref || !compensado({ account_id: body.account_id, created_at: c.created_at }, estornos.filter((e) => e.bank_ref === ref))
      })
    }

    // Decide a linha usando o cliente informado (prisma na simulação; tx travada no real).
    const planejar = async (db: Pick<typeof prisma, 'transaction'>, linha: Linha) => {
      // Já lançada: a linha (ou um lançamento convertido nela: chave, chave#2, …) já está no livro.
      // LIGADA:<chave> = marcador antigo, até a migração (§9) converter essas transações.
      const jaLancada =
        (await db.transaction.findFirst({
          where: {
            company_id: user.companyId,
            account_id: body.account_id,
            OR: [
              { bank_ref: linha.chave },
              { bank_ref: { startsWith: `${linha.chave}#` } },
              { source_text: `LIGADA:${linha.chave}` },
            ],
          },
          select: { id: true },
        })) !== null
      const links = linha.links ?? []
      const creditos =
        links.length > 0
          ? await db.transaction.findMany({
              where: { company_id: user.companyId, account_id: body.account_id, bank_ref: { in: links } },
              orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
              select: { id: true, bank_ref: true, amount: true, source_text: true, created_at: true, description: true, category_id: true },
            })
          : []
      // Ausente: já tomado por OUTRA linha (LIGADA:<outra chave>) ou criado até o ajuste (já absorvido por ele).
      // (O convertido por outra linha já não tem este bank_ref — nem aparece aqui.) Já estornado também não serve (§2).
      const ligaveis = await semCompensados(db, creditos.filter((c) => creditoUsavelParaVinculo(c, linha.chave, limiteOrfao)))
      const creditosExistentes = ligaveis.map((c) => ({ bank_ref: c.bank_ref as string, amount: c.amount }))
      return { plano: planejarLinha(linha, body.corte, jaLancada, creditosExistentes), ligaveis }
    }

    // Procura crédito/débito já existente ("órfão") que corresponda à linha, na mesma empresa e conta.
    // Só vale p/ linha sem vínculo nenhum; ignora órfãos já usados neste pedido.
    // Onda 4 (§2): nunca o par do estorno — nem o próprio :estorno, nem o nocional que ele já compensou.
    const buscarOrfao = async (db: Pick<typeof prisma, 'transaction'>, linha: Linha, usados: Set<string>) => {
      const { de, ate } = limitesJanelaOrfao(linha.data)
      const lidos = await db.transaction.findMany({
        where: {
          company_id: user.companyId,
          account_id: body.account_id,
          origin: null,
          source_text: null,
          OR: [{ bank_ref: null }, { NOT: { bank_ref: { endsWith: ':estorno' } } }],
          transaction_type: linha.valor_centavos > 0 ? 'CREDIT' : 'DEBIT',
          amount: Math.abs(linha.valor_centavos),
          transaction_date: { gte: de, lte: ate },
          created_at: { gt: limiteOrfao },
        },
        orderBy: [{ transaction_date: 'asc' }, { created_at: 'asc' }, { id: 'asc' }],
        select: { id: true, amount: true, transaction_type: true, transaction_date: true, bank_ref: true, description: true, category_id: true, created_at: true },
      })
      const candidatos = await semCompensados(db, lidos)
      const id = escolherOrfao(
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
      return candidatos.find((c) => c.id === id) ?? null
    }

    const categoriaDe = (linha: Linha, valor: number, identificar: boolean) => {
      const { category_id: porRegra } = classificar(linha, regras, body.account_id)
      const nomeFallback = identificar || valor > 0 ? 'Receita a identificar' : 'A classificar'
      return {
        id: porRegra ?? categorias.get(nomeFallback) ?? null,
        nome: porRegra ? (nomePorId.get(porRegra) ?? null) : nomeFallback,
      }
    }

    // Onda 4 (§1): o lançamento que o ERP criou por conta própria (AR:<id>, acquirer:…, pay_…, cnab:…, AP:<id>…)
    // VIRA a linha do banco — origin BANCO, bank_ref = chave (a 2ª, 3ª… de uma mesma linha: chave#2, chave#3),
    // texto/data do banco e o bank_ref antigo em linked_ref. Saldo intocado. `n` = posição na linha (0 = a própria chave).
    // Só converte o que ainda é nocional; false = outra requisição mexeu nele (nada gravado).
    type Convertivel = { id: string; bank_ref: string | null; description: string | null; category_id: string | null }
    const converter = async (tx: Pick<typeof prisma, 'transaction'>, t: Convertivel, linha: Linha, n: number) => {
      const descricao = t.description ?? ''
      const r = await tx.transaction.updateMany({
        where: { id: t.id, company_id: user.companyId, account_id: body.account_id, origin: null, source_text: null },
        data: {
          origin: 'BANCO',
          bank_ref: n === 0 ? linha.chave : `${linha.chave}#${n + 1}`,
          source_text: linha.descricao,
          counterparty: linha.contraparte ?? null,
          transaction_date: new Date(linha.data + 'T00:00:00.000Z'),
          linked_ref: t.bank_ref,
          description: descricao.includes(' · banco: ') ? descricao : `${descricao} · banco: ${linha.descricao}`,
          category_id: t.category_id ?? categoriaDe(linha, linha.valor_centavos, false).id,
          reconciled: true,
        },
      })
      return r.count === 1
    }

    // Converte os lançamentos citados em `links` a partir da posição `desde`; se algum mudou no meio, desfaz a linha.
    const converterLigaveis = async (tx: Pick<typeof prisma, 'transaction'>, ts: Convertivel[], linha: Linha, desde: number) => {
      for (const [i, t] of ts.entries()) {
        if (!(await converter(tx, t, linha, desde + i))) throw new Error('lançamento a ligar mudou durante o lançamento da linha — repita')
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
        const { plano } = await planejar(prisma, linha)
        if (plano.acao === 'CRIAR' && plano.refs_ligadas.length === 0) {
          const orfao = await buscarOrfao(prisma, linha, orfaosUsados)
          if (orfao) {
            orfaosUsados.add(orfao.id)
            resultados.push({ chave: linha.chave, acao: 'LIGAR', refs: [orfao.id], origem: 'orfao' })
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
        const { plano, ligaveis } = await planejar(tx, linha)

        if (plano.acao === 'IGNORAR') return { chave: linha.chave, acao: 'IGNORAR', motivo: plano.motivo }

        if (plano.acao === 'LIGAR') {
          await converterLigaveis(tx, ligaveis, linha, 0)
          return { chave: linha.chave, acao: 'LIGAR', refs: plano.refs }
        }

        // Linha sem vínculo: tenta ligar a um órfão existente antes de criar (não conta o dinheiro 2x).
        if (plano.refs_ligadas.length === 0) {
          const orfao = await buscarOrfao(tx, linha, orfaosUsados)
          if (orfao) {
            orfaosUsados.add(orfao.id)
            if (await converter(tx, orfao, linha, 0)) return { chave: linha.chave, acao: 'LIGAR', refs: [orfao.id], origem: 'orfao' }
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
        // A linha criada leva a chave; os lançamentos ligados viram chave#2, chave#3…
        if (plano.refs_ligadas.length > 0) await converterLigaveis(tx, ligaveis, linha, 1)
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
