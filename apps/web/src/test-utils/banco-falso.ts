// Banco em memória para os testes de rota do financeiro (onda 4, §10): um só conjunto de tabelas por teste,
// consultado pelos mesmos filtros do Prisma (where/select/include/orderBy), com DOIS clientes distintos — `prisma`
// (fora da transação) e `tx` (o que o $transaction entrega ao callback) — cada um com seus próprios spies.
// O $transaction desfaz tudo se o callback lançar (rollback) e o $queryRaw registra as travas (FOR UPDATE)
// na ordem em que foram pedidas. Qualquer modelo existe (tabela vazia até ser usada).
// Uso: vi.mock('@pontual/db', async () => ({ prisma: (await import('@/test-utils/banco-falso')).banco.prisma }))
import { vi } from 'vitest'

type Linha = Record<string, any>
type Tabelas = Record<string, Linha[]>

// Tabela SQL (do $queryRaw) → modelo.
const TABELA_SQL: Record<string, string> = {
  accounts: 'account',
  accounts_receivable: 'accountReceivable',
  accounts_payable: 'accountPayable',
}

// Relações usadas nos `select`/`include` das rotas: campo → (modelo, chave estrangeira).
const RELACOES: Record<string, { modelo: string; fk: string }> = {
  categories: { modelo: 'category', fk: 'category_id' },
  companies: { modelo: 'company', fk: 'company_id' },
}

const DEFAULTS: Record<string, Linha> = {
  account: { is_active: true, current_balance: 0, initial_balance: 0 },
  accountReceivable: {
    status: 'PENDENTE', received_amount: 0, account_id: null, category_id: null, reconciled: false, anticipated_at: null,
    group_id: null, grouped_into_id: null, pix_code: null, card_fee_total: 0, service_order_id: null, deleted_at: null, description: 'AR',
  },
  accountPayable: { status: 'PENDENTE', paid_amount: 0, account_id: null, category_id: null, reconciled: false, deleted_at: null, notes: null, description: 'AP', payment_method: null },
  transaction: {
    description: null, bank_ref: null, reconciled: false, category_id: null, origin: null, source_text: null, linked_ref: null, counterparty: null,
    desligada_de: null,
  },
  payment: { provider: 'asaas', status: 'PENDING', external_id: null, receivable_id: null },
  category: { module: null },
  classificationRule: { direction: null, account_id: null, priority: 100, active: true },
}

// Chaves únicas que as rotas usam para dedupe (create duplicado → P2002, como no Postgres).
const UNICAS: Record<string, string[][]> = {
  webhookEventLog: [['provider', 'event_id']],
}

const OPERADORES = new Set(['equals', 'in', 'notIn', 'not', 'gt', 'gte', 'lt', 'lte', 'startsWith', 'endsWith', 'contains', 'mode'])
// Nomes que não são modelos (o Proxy não cria tabela para eles).
const NAO_MODELO = new Set(['then', 'toJSON', 'constructor', 'asymmetricMatch', 'nodeType', 'tagName', '$$typeof', 'prototype'])

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
    // Chave única composta (ex.: provider_event_id: { provider, event_id }) = E das colunas.
    if (!(k in linha) && ehFiltro(cond) && Object.keys(cond as object).every((o) => !OPERADORES.has(o))) {
      if (!casa(linha, cond)) return false
      continue
    }
    if (!casaCampo(linha[k], cond)) return false
  }
  return true
}

const copia = (l: Linha): Linha => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, v instanceof Date ? new Date(v) : v]))

export function criarBanco() {
  let tabelas: Tabelas = {}
  let seq = 0
  let relogio = Date.now()
  let profundidadeTx = 0
  const log: Operacao[] = []
  const travas: Trava[] = []
  const transacoes: { opcoes: unknown; desfeita: boolean }[] = []
  let aoTravar: ((t: { tabela: string; id: string }) => void) | null = null
  let ids = 0
  // Fotos das transações abertas (o rollback volta a elas).
  const fotos: Tabelas[] = []

  const tab = (m: string) => (tabelas[m] ??= [])
  const agora = () => { relogio = Math.max(Date.now(), relogio + 1); return new Date(relogio) }

  const projetar = (l: Linha, select: any, include?: any): Linha => {
    const rel = (k: string, v: any) => {
      const r = RELACOES[k]
      const alvo = tab(r.modelo).find((x) => x.id === l[r.fk])
      return alvo ? projetar(alvo, typeof v === 'object' ? v.select : undefined) : null
    }
    if (!select) {
      const out = copia(l)
      for (const [k, v] of Object.entries(include ?? {})) if (v && RELACOES[k]) out[k] = rel(k, v)
      return out
    }
    const out: Linha = {}
    for (const [k, v] of Object.entries(select)) {
      if (!v) continue
      if (RELACOES[k] && typeof v === 'object') out[k] = rel(k, v)
      else out[k] = l[k] instanceof Date ? new Date(l[k]) : l[k]
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

  const novaLinha = (modelo: string, data: Linha): Linha => ({ id: `${modelo}-${++ids}`, ...(DEFAULTS[modelo] ?? {}), created_at: agora(), ...data })

  const ops = (modelo: string) => {
    const primeira = ({ where, select, include, orderBy }: any = {}) => {
      const l = ordenar(tab(modelo).filter((x) => casa(x, where)), orderBy)[0]
      return l ? projetar(l, select, include) : null
    }
    const ouErro = (args: any) => {
      const l = primeira(args)
      if (!l) throw Object.assign(new Error(`banco-falso: ${modelo} não encontrado`), { code: 'P2025' })
      return l
    }
    return {
      findFirst: async (args: any) => primeira(args),
      findUnique: async (args: any) => primeira(args),
      findFirstOrThrow: async (args: any) => ouErro(args),
      findUniqueOrThrow: async (args: any) => ouErro(args),
      findMany: async ({ where, select, include, orderBy }: any = {}) =>
        ordenar(tab(modelo).filter((x) => casa(x, where)), orderBy).map((l) => projetar(l, select, include)),
      count: async ({ where }: any = {}) => tab(modelo).filter((x) => casa(x, where)).length,
      create: async ({ data, select, include }: any) => {
        for (const cols of UNICAS[modelo] ?? []) {
          if (tab(modelo).some((x) => cols.every((c) => igual(x[c], data[c])))) {
            throw Object.assign(new Error(`banco-falso: ${modelo} duplicado (${cols.join(', ')})`), { code: 'P2002' })
          }
        }
        const l = novaLinha(modelo, data)
        tab(modelo).push(l)
        return projetar(l, select, include)
      },
      createMany: async ({ data }: any) => {
        for (const d of [].concat(data)) tab(modelo).push(novaLinha(modelo, d))
        return { count: [].concat(data).length }
      },
      update: async ({ where, data, select, include }: any) => {
        const l = tab(modelo).find((x) => casa(x, where))
        if (!l) throw Object.assign(new Error(`banco-falso: ${modelo} a atualizar não existe`), { code: 'P2025' })
        aplicar(l, data)
        return projetar(l, select, include)
      },
      updateMany: async ({ where, data }: any) => {
        const alvo = tab(modelo).filter((x) => casa(x, where))
        for (const l of alvo) aplicar(l, data)
        return { count: alvo.length }
      },
      upsert: async ({ where, create, update }: any) => {
        const l = tab(modelo).find((x) => casa(x, where))
        if (l) { aplicar(l, update); return copia(l) }
        const n = novaLinha(modelo, create)
        tab(modelo).push(n)
        return copia(n)
      },
      delete: async ({ where }: any) => {
        const i = tab(modelo).findIndex((x) => casa(x, where))
        if (i < 0) throw Object.assign(new Error(`banco-falso: ${modelo} a apagar não existe`), { code: 'P2025' })
        return tab(modelo).splice(i, 1)[0]
      },
      deleteMany: async ({ where }: any = {}) => {
        const antes = tab(modelo).length
        tabelas[modelo] = tab(modelo).filter((x) => !casa(x, where))
        return { count: antes - tabelas[modelo].length }
      },
    }
  }

  // SELECT … FROM <tabela> WHERE id = ${id} … FOR UPDATE → registra a trava; devolve a linha (se existir).
  const queryRaw = async (sql: TemplateStringsArray, ...valores: unknown[]) => {
    const texto = sql.join('?')
    const tabela = /FROM\s+(\w+)/i.exec(texto)?.[1] ?? '?'
    const id = String(valores[0])
    if (/FOR UPDATE/i.test(texto)) {
      travas.push({ seq: ++seq, tabela, id })
      if (aoTravar) {
        // O que o gancho grava é outra requisição que COMITOU enquanto esta esperava: vale também nas fotos das
        // transações abertas (sobrevive ao rollback desta).
        const antes: Tabelas = Object.fromEntries(Object.entries(tabelas).map(([m, ls]) => [m, ls.map(copia)]))
        aoTravar({ tabela, id })
        for (const foto of fotos) {
          for (const [m, ls] of Object.entries(tabelas)) {
            for (const l of ls) {
              const a = (antes[m] ?? []).find((x) => x.id === l.id)
              const f = (foto[m] ??= []).find((x) => x.id === l.id)
              if (!a) { if (!f) foto[m].push(copia(l)); continue }
              for (const k of new Set([...Object.keys(a), ...Object.keys(l)])) {
                if (valor(a[k]) !== valor(l[k]) && f) f[k] = l[k] instanceof Date ? new Date(l[k]) : l[k]
              }
            }
          }
          // Fix 3 (m14): o que o gancho APAGOU também comitou — sai da foto (não ressuscita no rollback).
          for (const [m, ls] of Object.entries(antes)) {
            const vivas = new Set((tabelas[m] ?? []).map((x) => x.id))
            const apagadas = new Set(ls.filter((x) => !vivas.has(x.id)).map((x) => x.id))
            if (apagadas.size > 0 && foto[m]) foto[m] = foto[m].filter((x) => !apagadas.has(x.id))
          }
        }
      }
    }
    const modelo = TABELA_SQL[tabela]
    const l = modelo ? tab(modelo).find((x) => x.id === id) : undefined
    return l ? [{ id: l.id, current_balance: l.current_balance }] : []
  }

  // Cliente com spies próprios (criados no 1º uso de cada modelo); cada chamada vai para o log (com quem chamou e se
  // havia transação aberta). Escrita do cliente `prisma` com transação aberta = outra conexão: já está comitada e
  // sobrevive ao rollback da tx.
  const ESCRITAS = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'])
  let foraDaTx: { modelo: string; op: string; args: any }[] = []
  const criarCliente = (cliente: 'prisma' | 'tx') => {
    const base: Record<string, any> = {
      $queryRaw: vi.fn(async (sql: TemplateStringsArray, ...valores: unknown[]) => {
        log.push({ seq: ++seq, cliente, dentroDaTx: profundidadeTx > 0, modelo: '$queryRaw', op: 'queryRaw', args: { sql: sql.join('?'), valores } })
        return queryRaw(sql, ...valores)
      }),
    }
    return new Proxy(base, {
      get(alvo, prop) {
        if (typeof prop !== 'string' || prop in alvo || NAO_MODELO.has(prop) || prop.startsWith('$')) return alvo[prop as string]
        const modelo = prop
        alvo[modelo] = Object.fromEntries(Object.entries(ops(modelo)).map(([op, fn]) => [op, vi.fn(async (args: any) => {
          log.push({ seq: ++seq, cliente, dentroDaTx: profundidadeTx > 0, modelo, op, args })
          if (cliente === 'prisma' && profundidadeTx > 0 && ESCRITAS.has(op)) foraDaTx.push({ modelo, op, args })
          return (fn as any)(args)
        })]))
        return alvo[modelo]
      },
    }) as Record<string, any>
  }

  const tx = criarCliente('tx')
  const prisma = criarCliente('prisma')
  prisma.$transaction = vi.fn(async (cb: any, opcoes?: unknown) => {
    if (Array.isArray(cb)) return Promise.all(cb)
    const foto: Tabelas = Object.fromEntries(Object.entries(tabelas).map(([m, ls]) => [m, ls.map(copia)]))
    const registro = { opcoes, desfeita: false }
    transacoes.push(registro)
    const foraAntes = foraDaTx
    foraDaTx = []
    profundidadeTx++
    fotos.push(foto)
    try {
      return await cb(tx)
    } catch (e) {
      tabelas = foto
      registro.desfeita = true
      // O que foi gravado pelo cliente de fora não é desfeito pelo rollback desta tx.
      for (const w of foraDaTx) await (ops(w.modelo) as any)[w.op](w.args).catch(() => undefined)
      throw e
    } finally {
      profundidadeTx--
      fotos.pop()
      foraDaTx = foraAntes
    }
  })

  const inserir = (modelo: string, l: Linha) => {
    const linha = novaLinha(modelo, l)
    tab(modelo).push(linha)
    return linha
  }

  return {
    prisma,
    tx,
    log,
    travas,
    transacoes,
    get tabelas() { return new Proxy(tabelas, { get: (t, m) => (typeof m === 'string' ? (t[m] ??= []) : undefined) }) },
    /**
     * Zera tabelas, log, travas e spies (os clientes continuam os mesmos objetos). mockReset (não mockClear): descarta
     * mockImplementationOnce/mockReturnValueOnce pendentes e volta à implementação base do vi.fn (F2-G, m23).
     */
    reset() {
      tabelas = {}
      log.length = 0; travas.length = 0; transacoes.length = 0; aoTravar = null
      for (const c of [prisma, tx]) for (const k of Object.keys(c)) {
        const v = c[k]
        if (typeof v === 'function' && 'mockReset' in v) (v as any).mockReset()
        else if (v && typeof v === 'object') for (const f of Object.values(v)) (f as any).mockReset?.()
      }
    },
    /** Simula outra requisição que comitou enquanto esta esperava a trava (roda uma vez por trava pedida). */
    aoTravar(fn: ((t: { tabela: string; id: string }) => void) | null) { aoTravar = fn },
    /** Chamadas do cliente `prisma` feitas com uma transação aberta (fora do FOR UPDATE e do rollback). */
    prismaDentroDaTx: () => log.filter((o) => o.cliente === 'prisma' && o.dentroDaTx),
    inserir,
    conta: (l: Linha = {}) => inserir('account', { company_id: 'c1', name: 'Conta', ...l }),
    ar: (l: Linha = {}) => inserir('accountReceivable', { company_id: 'c1', total_amount: 0, due_date: new Date('2026-10-01T00:00:00Z'), ...l }),
    ap: (l: Linha = {}) => inserir('accountPayable', { company_id: 'c1', total_amount: 0, due_date: new Date('2026-10-01T00:00:00Z'), ...l }),
    transacao: (l: Linha) => inserir('transaction', { company_id: 'c1', transaction_date: new Date('2026-10-01T00:00:00Z'), ...l }),
    pagamento: (l: Linha) => inserir('payment', { company_id: 'c1', customer_id: 'cli1', amount: 0, idempotency_key: `k${ids}`, ...l }),
    categoria: (name: string, module: string | null = null) => inserir('category', { id: `cat:${name}`, company_id: 'c1', name, module }),
    regra: (l: Linha) => inserir('classificationRule', { company_id: 'c1', ...l }),
    saldo: (contaId: string) => tab('account').find((a) => a.id === contaId)?.current_balance as number,
    tx_: (id: string) => tab('transaction').find((t) => t.id === id),
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
