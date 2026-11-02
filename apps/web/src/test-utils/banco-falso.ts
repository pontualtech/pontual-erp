// Banco em memória para os testes de rota do financeiro (onda 4, §10): um só conjunto de tabelas por teste,
// consultado pelos mesmos filtros do Prisma (where/select/orderBy), com DOIS clientes distintos — `prisma`
// (fora da transação) e `tx` (o que o $transaction entrega ao callback) — cada um com seus próprios spies.
// O $transaction desfaz tudo se o callback lançar (rollback) e o $queryRaw registra as travas (FOR UPDATE)
// na ordem em que foram pedidas. Uso: vi.mock('@pontual/db', async () => ({ prisma: (await import('@/test-utils/banco-falso')).banco.prisma }))
import { vi } from 'vitest'

type Linha = Record<string, any>
const MODELOS = ['account', 'accountReceivable', 'accountPayable', 'transaction', 'payment', 'category', 'classificationRule'] as const
type Modelo = (typeof MODELOS)[number]
type Tabelas = Record<Modelo, Linha[]>

// Tabela SQL (do $queryRaw) → modelo.
const TABELA_SQL: Record<string, Modelo> = {
  accounts: 'account',
  accounts_receivable: 'accountReceivable',
  accounts_payable: 'accountPayable',
}

// Relações usadas nos `select` das rotas: campo → (modelo, chave estrangeira).
const RELACOES: Record<string, { modelo: Modelo; fk: string }> = {
  categories: { modelo: 'category', fk: 'category_id' },
}

const DEFAULTS: Record<Modelo, Linha> = {
  account: { is_active: true, current_balance: 0, initial_balance: 0 },
  accountReceivable: {
    status: 'PENDENTE', received_amount: 0, account_id: null, category_id: null, reconciled: false, anticipated_at: null,
    group_id: null, grouped_into_id: null, pix_code: null, card_fee_total: 0, service_order_id: null, deleted_at: null, description: 'AR',
  },
  accountPayable: { status: 'PENDENTE', paid_amount: 0, account_id: null, category_id: null, reconciled: false, deleted_at: null, notes: null, description: 'AP', payment_method: null },
  transaction: {
    description: null, bank_ref: null, reconciled: false, category_id: null, origin: null, source_text: null, linked_ref: null, counterparty: null,
  },
  payment: { provider: 'asaas', status: 'PENDING', external_id: null },
  category: { module: null },
  classificationRule: { direction: null, account_id: null, priority: 100, active: true },
}

export interface Operacao {
  seq: number
  cliente: 'prisma' | 'tx'
  dentroDaTx: boolean
  modelo: string
  op: string
  args: any
}

export interface Trava { seq: number; tabela: string; id: string }

const ehFiltro = (c: unknown) => c !== null && typeof c === 'object' && !(c instanceof Date) && !Array.isArray(c)
const valor = (x: unknown) => (x instanceof Date ? x.getTime() : x)
const igual = (a: unknown, b: unknown) => (a ?? null) === null ? (b ?? null) === null : valor(a) === valor(b)

function casaCampo(v: unknown, cond: unknown): boolean {
  if (!ehFiltro(cond)) return igual(v, cond)
  const c = cond as Record<string, any>
  const ins = c.mode === 'insensitive'
  const s = (x: unknown) => (ins && typeof x === 'string' ? x.toLowerCase() : x)
  for (const [op, alvo] of Object.entries(c)) {
    if (op === 'mode' || alvo === undefined) continue
    switch (op) {
      case 'equals': if (!igual(s(v), s(alvo))) return false; break
      case 'in': if ((v ?? null) === null || !(alvo as unknown[]).some((x) => igual(v, x))) return false; break
      // SQL: NULL NOT IN (…) e NULL <> x não são verdadeiros — a linha com NULL fica de fora.
      case 'notIn': if ((v ?? null) === null || (alvo as unknown[]).some((x) => igual(v, x))) return false; break
      case 'not':
        if (alvo === null) { if ((v ?? null) === null) return false }
        else if (ehFiltro(alvo)) { if ((v ?? null) === null || casaCampo(v, alvo)) return false }
        else if ((v ?? null) === null || igual(v, alvo)) return false
        break
      case 'gt': if ((v ?? null) === null || !((valor(v) as number) > (valor(alvo) as number))) return false; break
      case 'gte': if ((v ?? null) === null || !((valor(v) as number) >= (valor(alvo) as number))) return false; break
      case 'lt': if ((v ?? null) === null || !((valor(v) as number) < (valor(alvo) as number))) return false; break
      case 'lte': if ((v ?? null) === null || !((valor(v) as number) <= (valor(alvo) as number))) return false; break
      case 'startsWith': if (typeof v !== 'string' || !(s(v) as string).startsWith(s(alvo) as string)) return false; break
      case 'endsWith': if (typeof v !== 'string' || !(s(v) as string).endsWith(s(alvo) as string)) return false; break
      case 'contains': if (typeof v !== 'string' || !(s(v) as string).includes(s(alvo) as string)) return false; break
      default: throw new Error(`banco-falso: operador não suportado '${op}'`)
    }
  }
  return true
}

export function casa(linha: Linha, where: any): boolean {
  if (!where) return true
  for (const [k, cond] of Object.entries(where)) {
    if (cond === undefined) continue
    if (k === 'OR') { if (!(cond as any[]).some((w) => casa(linha, w))) return false; continue }
    if (k === 'AND') { if (!([] as any[]).concat(cond).every((w) => casa(linha, w))) return false; continue }
    if (k === 'NOT') { if (([] as any[]).concat(cond).some((w) => casa(linha, w))) return false; continue }
    if (!casaCampo(linha[k], cond)) return false
  }
  return true
}

const copia = (l: Linha): Linha => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, v instanceof Date ? new Date(v) : v]))

export function criarBanco() {
  let tabelas: Tabelas = Object.fromEntries(MODELOS.map((m) => [m, []])) as unknown as Tabelas
  let seq = 0
  let relogio = Date.now()
  let profundidadeTx = 0
  const log: Operacao[] = []
  const travas: Trava[] = []
  const transacoes: { opcoes: unknown; desfeita: boolean }[] = []
  let aoTravar: ((t: { tabela: string; id: string }) => void) | null = null
  let ids = 0

  const agora = () => { relogio = Math.max(Date.now(), relogio + 1); return new Date(relogio) }

  const projetar = (modelo: Modelo, l: Linha, select: any): Linha => {
    if (!select) return copia(l)
    const out: Linha = {}
    for (const [k, v] of Object.entries(select)) {
      if (!v) continue
      const rel = RELACOES[k]
      if (rel && typeof v === 'object') {
        const alvo = tabelas[rel.modelo].find((x) => x.id === l[rel.fk])
        out[k] = alvo ? projetar(rel.modelo, alvo, (v as any).select) : null
      } else out[k] = l[k] instanceof Date ? new Date(l[k]) : l[k]
    }
    return out
  }

  const ordenar = (lista: Linha[], orderBy: any) => {
    if (!orderBy) return lista
    const criterios = ([] as any[]).concat(orderBy).flatMap((o) => Object.entries(o)) as [string, 'asc' | 'desc'][]
    return [...lista].sort((a, b) => {
      for (const [k, dir] of criterios) {
        const va = valor(a[k]) as any, vb = valor(b[k]) as any
        if (va === vb) continue
        const r = va === null || va === undefined ? -1 : vb === null || vb === undefined ? 1 : va < vb ? -1 : 1
        return dir === 'desc' ? -r : r
      }
      return 0
    })
  }

  const aplicar = (l: Linha, data: Linha) => {
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue
      if (ehFiltro(v) && ('increment' in (v as any) || 'decrement' in (v as any))) {
        const atual = (l[k] ?? 0) as number
        l[k] = 'increment' in (v as any) ? atual + (v as any).increment : atual - (v as any).decrement
      } else l[k] = v instanceof Date ? new Date(v) : v
    }
  }

  const ops = (modelo: Modelo) => ({
    findFirst: async ({ where, select, orderBy }: any = {}) => {
      const l = ordenar(tabelas[modelo].filter((x) => casa(x, where)), orderBy)[0]
      return l ? projetar(modelo, l, select) : null
    },
    findFirstOrThrow: async ({ where, select }: any = {}) => {
      const l = tabelas[modelo].find((x) => casa(x, where))
      if (!l) throw new Error(`banco-falso: ${modelo} não encontrado`)
      return projetar(modelo, l, select)
    },
    findMany: async ({ where, select, orderBy }: any = {}) =>
      ordenar(tabelas[modelo].filter((x) => casa(x, where)), orderBy).map((l) => projetar(modelo, l, select)),
    count: async ({ where }: any = {}) => tabelas[modelo].filter((x) => casa(x, where)).length,
    create: async ({ data, select }: any) => {
      const l: Linha = { id: `${modelo}-${++ids}`, ...DEFAULTS[modelo], created_at: agora(), ...data }
      tabelas[modelo].push(l)
      return projetar(modelo, l, select)
    },
    update: async ({ where, data, select }: any) => {
      const l = tabelas[modelo].find((x) => casa(x, where))
      if (!l) throw Object.assign(new Error(`banco-falso: ${modelo} a atualizar não existe`), { code: 'P2025' })
      aplicar(l, data)
      return projetar(modelo, l, select)
    },
    updateMany: async ({ where, data }: any) => {
      const alvo = tabelas[modelo].filter((x) => casa(x, where))
      for (const l of alvo) aplicar(l, data)
      return { count: alvo.length }
    },
    delete: async ({ where }: any) => {
      const i = tabelas[modelo].findIndex((x) => casa(x, where))
      if (i < 0) throw Object.assign(new Error(`banco-falso: ${modelo} a apagar não existe`), { code: 'P2025' })
      return tabelas[modelo].splice(i, 1)[0]
    },
  })

  // SELECT … FROM <tabela> WHERE id = ${id} … FOR UPDATE → registra a trava; devolve a linha (se existir).
  const queryRaw = async (sql: TemplateStringsArray, ...valores: unknown[]) => {
    const texto = sql.join('?')
    const tabela = /FROM\s+(\w+)/i.exec(texto)?.[1] ?? '?'
    const id = String(valores[0])
    if (/FOR UPDATE/i.test(texto)) {
      travas.push({ seq: ++seq, tabela, id })
      aoTravar?.({ tabela, id })
    }
    const modelo = TABELA_SQL[tabela]
    const l = modelo ? tabelas[modelo].find((x) => x.id === id) : undefined
    return l ? [{ id: l.id, current_balance: l.current_balance }] : []
  }

  // Cliente com spies próprios; cada chamada vai para o log (com quem chamou e se havia transação aberta).
  const criarCliente = (cliente: 'prisma' | 'tx') => {
    const c: Record<string, any> = {}
    for (const modelo of MODELOS) {
      const base = ops(modelo)
      c[modelo] = Object.fromEntries(Object.entries(base).map(([op, fn]) => [op, vi.fn(async (args: any) => {
        log.push({ seq: ++seq, cliente, dentroDaTx: profundidadeTx > 0, modelo, op, args })
        return (fn as any)(args)
      })]))
    }
    c.$queryRaw = vi.fn(async (sql: TemplateStringsArray, ...valores: unknown[]) => {
      log.push({ seq: ++seq, cliente, dentroDaTx: profundidadeTx > 0, modelo: '$queryRaw', op: 'queryRaw', args: { sql: sql.join('?'), valores } })
      return queryRaw(sql, ...valores)
    })
    return c
  }

  const tx = criarCliente('tx')
  const prisma = criarCliente('prisma')
  prisma.$transaction = vi.fn(async (cb: any, opcoes?: unknown) => {
    if (Array.isArray(cb)) return Promise.all(cb)
    const foto = Object.fromEntries(MODELOS.map((m) => [m, tabelas[m].map(copia)])) as unknown as Tabelas
    const registro = { opcoes, desfeita: false }
    transacoes.push(registro)
    profundidadeTx++
    try {
      return await cb(tx)
    } catch (e) {
      tabelas = foto
      registro.desfeita = true
      throw e
    } finally {
      profundidadeTx--
    }
  })

  const inserir = (modelo: Modelo, l: Linha) => {
    const linha = { id: `${modelo}-${++ids}`, ...DEFAULTS[modelo], created_at: agora(), ...l }
    tabelas[modelo].push(linha)
    return linha
  }

  return {
    prisma,
    tx,
    log,
    travas,
    transacoes,
    get tabelas() { return tabelas },
    /** Zera tabelas, log, travas e spies (os clientes continuam os mesmos objetos). */
    reset() {
      tabelas = Object.fromEntries(MODELOS.map((m) => [m, []])) as unknown as Tabelas
      log.length = 0; travas.length = 0; transacoes.length = 0; aoTravar = null
      for (const c of [prisma, tx]) for (const v of Object.values(c)) {
        if (typeof v === 'function' && 'mockClear' in v) (v as any).mockClear()
        else if (v && typeof v === 'object') for (const f of Object.values(v)) (f as any).mockClear?.()
      }
    },
    /** Simula outra requisição que comitou enquanto esta esperava a trava (roda uma vez por trava pedida). */
    aoTravar(fn: ((t: { tabela: string; id: string }) => void) | null) { aoTravar = fn },
    /** Chamadas do cliente `prisma` feitas com uma transação aberta (fora do FOR UPDATE e do rollback). */
    prismaDentroDaTx: () => log.filter((o) => o.cliente === 'prisma' && o.dentroDaTx),
    conta: (l: Linha = {}) => inserir('account', { company_id: 'c1', name: 'Conta', ...l }),
    ar: (l: Linha = {}) => inserir('accountReceivable', { company_id: 'c1', total_amount: 0, due_date: new Date('2026-10-01T00:00:00Z'), ...l }),
    ap: (l: Linha = {}) => inserir('accountPayable', { company_id: 'c1', total_amount: 0, due_date: new Date('2026-10-01T00:00:00Z'), ...l }),
    transacao: (l: Linha) => inserir('transaction', { company_id: 'c1', transaction_date: new Date('2026-10-01T00:00:00Z'), ...l }),
    pagamento: (l: Linha) => inserir('payment', { company_id: 'c1', customer_id: 'cli1', amount: 0, idempotency_key: `k${ids}`, ...l }),
    categoria: (name: string, module: string | null = null) => inserir('category', { id: `cat:${name}`, company_id: 'c1', name, module }),
    regra: (l: Linha) => inserir('classificationRule', { company_id: 'c1', ...l }),
    saldo: (contaId: string) => tabelas.account.find((a) => a.id === contaId)?.current_balance as number,
    tx_: (id: string) => tabelas.transaction.find((t) => t.id === id),
    /** Categorias do livro + a receita padrão, com ids legíveis ('cat:<nome>'). */
    categoriasPadrao() {
      for (const [nome, modulo] of [
        ['Receita a identificar', 'financeiro_receita'], ['A classificar', 'financeiro_despesa'],
        ['Venda de Servicos', 'financeiro_receita'], ['Rendimentos', 'financeiro_receita'],
        ['Energia', 'financeiro_despesa'], ['Transferência entre contas', 'financeiro_despesa'],
      ] as const) this.categoria(nome, modulo)
    },
  }
}

export type BancoFalso = ReturnType<typeof criarBanco>

// Instância única por arquivo de teste (o vi.mock e o teste importam o mesmo módulo).
export const banco = criarBanco()
