// Acesso ao banco da baixa sobre o Livro-razão (a decisão pura fica em livro-baixa.ts).
// Recebe o `tx` do Prisma para rodar dentro da mesma $transaction da baixa.
import { refCnab, type CandidatoLivro, type JanelaBaixa } from './livro-baixa'
import { classificar, compensado, ondeRef, refEstorno } from './livro'
import { refsCreditoAdquirente } from '@/lib/acquirer/match-rules'

const DIA_MS = 86_400_000

// Conflito de concorrência na baixa (outra requisição mudou a conta entre a leitura e a gravação) → 409;
// valor acima do restante só visto dentro da tx → 422. Lançado dentro da $transaction: nada fica gravado.
export class ConflitoBaixa extends Error {
  constructor(message: string, readonly status: 409 | 422 = 409) {
    super(message)
  }
}

// Data de hoje em America/Sao_Paulo como 'AAAA-MM-DD' (en-CA já formata assim).
export function hojeSP(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
}

// Lançamentos do livro (origin BANCO) da MESMA conta dentro da `janela` em torno de `data` (JANELA_BAIXA no
// Receber/Pagar, JANELA_CONFERIR no Conferir sem vínculo explícito — a mesma passada a decidirBaixa);
// o lançamento escolhido explicitamente entra mesmo fora da janela. `categoria` = nome da categoria.
export async function candidatosLivro(
  tx: any,
  companyId: string,
  accountId: string,
  tipo: 'CREDIT' | 'DEBIT',
  data: string,
  explicito: string | null,
  janela: JanelaBaixa,
): Promise<CandidatoLivro[]> {
  const base = Date.parse(`${data}T00:00:00Z`)
  const naJanela = {
    transaction_date: {
      gte: new Date(base - janela.antes * DIA_MS),
      lte: new Date(base + janela.depois * DIA_MS),
    },
  }
  const rows: any[] = await tx.transaction.findMany({
    where: {
      company_id: companyId,
      account_id: accountId,
      transaction_type: tipo,
      origin: 'BANCO',
      OR: explicito ? [naJanela, { id: explicito }] : [naJanela],
    },
    select: {
      id: true, amount: true, transaction_type: true, transaction_date: true,
      linked_ref: true, origin: true, category_id: true, categories: { select: { name: true } },
    },
  })
  return rows.map((r) => ({
    id: r.id,
    amount: r.amount,
    transaction_type: r.transaction_type,
    transaction_date: new Date(r.transaction_date).toISOString().slice(0, 10),
    categoria: r.categories?.name ?? null,
    category_id: r.category_id ?? null,
    linked_ref: r.linked_ref ?? null,
    origin: r.origin ?? null,
  }))
}

// Id da categoria pelo nome (e módulo, se informado) na empresa; null se não existir (nunca cria).
export async function categoriaId(tx: any, companyId: string, name: string, module?: string): Promise<string | null> {
  const c = await tx.category.findFirst({
    where: { company_id: companyId, name, ...(module ? { module } : {}) },
    select: { id: true },
  })
  return c?.id ?? null
}

// Nome da categoria pelo id na empresa; null se não houver id ou categoria.
export async function nomeCategoria(tx: any, companyId: string, id: string | null): Promise<string | null> {
  if (!id) return null
  const c = await tx.category.findFirst({ where: { id, company_id: companyId }, select: { name: true } })
  return c?.name ?? null
}

// ── Onda 4 (§7): ordem única de travas — contas (accounts, por id) → conta a receber/pagar → transações. ──

// A releitura com as travas achou lançamento numa conta que não foi travada (mudou entre a leitura e a trava) → 409.
export class ContaAlterada extends Error {
  constructor() {
    super('conta alterada — repita')
  }
}

// Trava (FOR UPDATE) as contas informadas, sem repetir e sempre em ordem de id (duas rotas nunca se cruzam).
export async function travarContas(tx: any, companyId: string, ids: (string | null | undefined)[]): Promise<Set<string>> {
  const unicas = [...new Set(ids.filter((id): id is string => !!id))].sort()
  for (const id of unicas) {
    await tx.$queryRaw`SELECT id FROM accounts WHERE id = ${id} AND company_id = ${companyId} FOR UPDATE`
  }
  return new Set(unicas)
}

// Fix 2 (F2-D, m9): deadlock/serialização (P2034) ou tx que estourou o tempo esperando trava (P2028) → 409 'repita'
// em vez de 500 (nada foi gravado: a tx foi desfeita).
export const CONFLITO_BANCO = 'conflito com outra operação — repita'
// Fix 4 (F4-D, m3): no Prisma 5 com Postgres (READ COMMITTED) o deadlock real chega como P2010 'Raw query failed.
// Code: `40P01`' (nas travas $queryRaw) ou como erro sem code com 'PostgresError { code: "40P01" }' (ORM); a falha de
// serialização é 40001. Os dois contam pelo SQLSTATE (meta.code ou mensagem); P2010 de outro SQLSTATE não é conflito.
export function conflitoDeBanco(e: unknown): boolean {
  const err = e as { code?: unknown; meta?: { code?: unknown } | null; message?: unknown } | null
  if (!err) return false
  if (err.code === 'P2034' || err.code === 'P2028') return true
  if (err.meta?.code === '40P01' || err.meta?.code === '40001') return true
  return typeof err.message === 'string' && /code\W{1,4}(40P01|40001)\b/i.test(err.message)
}

// Toda conta que a rota vai escrever precisa estar entre as travadas; senão desfaz (ContaAlterada).
export function exigirTravadas(travadas: Set<string>, ids: (string | null | undefined)[]): void {
  if (ids.some((id) => !!id && !travadas.has(id))) throw new ContaAlterada()
}

// ── Onda 4: referências do dinheiro de uma conta a receber ──
// proprio/antecipacao/estorno = nocionais do ERP; externos = créditos reais do adquirente/Asaas (via Payment) e do CNAB.
export interface RefsAR {
  proprio: string
  antecipacao: string
  estorno: string
  externos: string[]
  pagamentos: { provider: string | null; external_id: string | null; status: string | null }[]
}

export async function refsDaAR(db: any, companyId: string, ar: { id: string; pix_code?: string | null }): Promise<RefsAR> {
  const pagamentos = await db.payment.findMany({
    where: { company_id: companyId, receivable_id: ar.id },
    select: { provider: true, external_id: true, status: true },
  })
  const cnab = refCnab(ar.pix_code)
  return {
    proprio: `AR:${ar.id}`,
    antecipacao: `AR:${ar.id}:anticipation`,
    estorno: `AR:${ar.id}:estorno`,
    externos: [...refsCreditoAdquirente(pagamentos), ...(cnab ? [cnab] : [])],
    pagamentos,
  }
}

// Linhas do banco que representam o dinheiro da AR: ligadas pela baixa (AR:<id>) ou convertidas de um nocional dela.
export const refsLigadasAR = (r: RefsAR) => [r.proprio, r.antecipacao, ...r.externos]

// Onda 4 (fix 2, F2-A): o dinheiro que já representa a conta — as linhas do BANCO ligadas/convertidas a qualquer ref dela
// e os nocionais ainda vivos (sem :estorno posterior). É o `existing` do Conferir (§5) e o que o Receber/Pagar consultam
// antes de lançar. `total` = soma; `conta` = conta do primeiro lançamento achado (para a conta que não tem uma).
export interface Lancado { id: string; amount: number; account_id: string; bank_ref: string | null; source_text: string | null; created_at: Date | null }
export interface DinheiroLancado { linhas: { id: string; amount: number; account_id: string }[]; nocionais: Lancado[]; total: number; conta: string | null }
const SELECT_LANCADO = { id: true, amount: true, account_id: true, bank_ref: true, source_text: true, created_at: true } as const
const resumir = (linhas: DinheiroLancado['linhas'], nocionais: Lancado[]): DinheiroLancado => ({
  linhas, nocionais,
  total: [...linhas, ...nocionais].reduce((s, t) => s + t.amount, 0),
  conta: (linhas[0] ?? nocionais[0])?.account_id ?? null,
})

export async function dinheiroDaAR(db: any, companyId: string, ar: { id: string; pix_code?: string | null }): Promise<DinheiroLancado & { refs: RefsAR }> {
  const refs = await refsDaAR(db, companyId, ar)
  const linhas = await db.transaction.findMany({
    where: { company_id: companyId, origin: 'BANCO', linked_ref: { in: refsLigadasAR(refs) } },
    select: { id: true, amount: true, account_id: true, linked_ref: true, bank_ref: true },
  })
  // origin null inclui o marcador antigo LIGADA: (dinheiro do banco até a migração).
  const lancados: Lancado[] = await db.transaction.findMany({
    where: { company_id: companyId, origin: null, bank_ref: { in: [refs.proprio, refs.antecipacao, ...refs.externos] } },
    select: SELECT_LANCADO,
  })
  const estornos = await db.transaction.findMany({
    where: { company_id: companyId, bank_ref: refs.estorno },
    select: { account_id: true, created_at: true },
  })
  // Nocional próprio já compensado por :estorno não é dinheiro da conta (o par se anula).
  const vivos = lancados.filter((t) => refEstorno(t.bank_ref) === null || !compensado(t, estornos))

  // Fix 3 (F3-B, #9/#3): o dinheiro de uma ref externa é líquido da reversão que o webhook Asaas cria (DEBIT
  // `${ref}-refund` / `${ref}-chargeback`, nocional ou já convertido na linha do banco, em qualquer conta). Ref
  // revertida por inteiro deixa de ser dinheiro da AR; revertida em parte conta só o que sobrou.
  const revertidas = refs.externos.flatMap((r) => [`${r}-refund`, `${r}-chargeback`])
  const reversoes: { amount: number; bank_ref: string | null; linked_ref: string | null }[] = revertidas.length === 0 ? [] : await db.transaction.findMany({
    where: { company_id: companyId, transaction_type: 'DEBIT', ...ondeRef(revertidas) },
    select: { amount: true, bank_ref: true, linked_ref: true },
  })
  const mortas = new Set<string>()
  let descontar = 0
  // Fix 4 (F4-C, #2) / fix 6 (F6-C, #5, m9): o dinheiro de um pagamento pode estar ligado pela ref PRÓPRIA (linha
  // ASAAS:PAY:<pay> ligada como AR:<id> por um vínculo explícito). Revertido sem crédito/linha viva da ref dele, a
  // reversão sai SÓ dessa linha (a do mesmo pagamento, até o valor dela) — nunca do dinheiro AR:<id> de outra origem
  // (Caixa, PIX no Itaú): o reembolso de um pagamento que nunca entrou não abre espaço para um 2º crédito.
  const linhaDoPagamento = (r: string) => linhas
    .filter((l: { linked_ref?: string | null; bank_ref?: string | null }) => l.linked_ref === refs.proprio && l.bank_ref === `ASAAS:PAY:${r}`)
    .reduce((soma: number, l: { amount: number }) => soma + l.amount, 0)
  for (const r of refs.externos) {
    const rev = reversoes
      .filter((d) => [d.bank_ref, d.linked_ref].some((x) => x === `${r}-refund` || x === `${r}-chargeback`))
      .reduce((soma, d) => soma + d.amount, 0)
    if (rev === 0) continue
    const cred = [...linhas.filter((l: { linked_ref?: string | null }) => l.linked_ref === r), ...vivos.filter((t) => t.bank_ref === r)]
      .reduce((soma, t) => soma + t.amount, 0)
    if (cred === 0) {
      descontar += Math.min(rev, linhaDoPagamento(r))
      continue
    }
    if (rev >= cred) mortas.add(r)
    else descontar += rev
  }
  const linhasVivas = linhas.filter((l: { linked_ref?: string | null }) => !mortas.has(l.linked_ref ?? ''))
  const nocionais = vivos.filter((t) => !mortas.has(t.bank_ref ?? ''))
  const resumo = resumir(linhasVivas.map(({ id, amount, account_id }: DinheiroLancado['linhas'][number]) => ({ id, amount, account_id })), nocionais)
  return { refs, ...resumo, total: Math.max(0, resumo.total - descontar) }
}

export async function dinheiroDaAP(db: any, companyId: string, apId: string): Promise<DinheiroLancado> {
  const linhas = await db.transaction.findMany({
    where: { company_id: companyId, origin: 'BANCO', linked_ref: `AP:${apId}` },
    select: { id: true, amount: true, account_id: true },
  })
  const lancados: Lancado[] = await db.transaction.findMany({
    where: { company_id: companyId, origin: null, bank_ref: `AP:${apId}`, transaction_type: 'DEBIT' },
    select: SELECT_LANCADO,
  })
  const estornos = await db.transaction.findMany({
    where: { company_id: companyId, bank_ref: `AP:${apId}:estorno` },
    select: { account_id: true, created_at: true },
  })
  return resumir(linhas, lancados.filter((t) => !compensado(t, estornos)))
}

// Aviso das baixas quando o dinheiro já está lançado (F2-A).
export const AVISO_JA_LANCADO = 'dinheiro desta conta já está lançado (adquirente/CNAB/Asaas/banco) — nenhum lançamento novo criado'

// Contas onde a AR tem dinheiro (a dela + as dos lançamentos próprios e das linhas ligadas) — o que travar.
export async function contasDaAR(db: any, companyId: string, ar: { id: string; account_id: string | null; pix_code?: string | null }): Promise<(string | null)[]> {
  const r = await refsDaAR(db, companyId, ar)
  // Fix 3 (F3-F): + a linha ASAAS:PAY:<pay> ainda livre (o Conferir a liga ao pagamento; fica na conta do Asaas).
  const asaasPay = r.pagamentos.filter((p) => p.provider === 'asaas' && p.external_id).map((p) => `ASAAS:PAY:${p.external_id}`)
  const ts: { account_id: string }[] = await db.transaction.findMany({
    where: {
      company_id: companyId,
      OR: [{ bank_ref: { in: [r.proprio, r.antecipacao, r.estorno, ...r.externos, ...asaasPay] } }, { linked_ref: { in: refsLigadasAR(r) } }],
    },
    select: { account_id: true },
  })
  return [ar.account_id, ...ts.map((t) => t.account_id)]
}

// Conta Asaas da empresa. Fix 6 (F6-D, #4/#9/#12): 1º a conta ativa do provedor (provider_config.provider = 'asaas',
// o critério do extrato Asaas — é nela que o livro posta as linhas ASAAS:PAY); 2º nome/banco com 'asaas' ou 'assas'
// (a conta de produção chama 'ASSAS', como no account-resolver).
export async function contaAsaasDaEmpresa(db: any, companyId: string): Promise<string | null> {
  const contas: { id: string; name: string | null; bank_name: string | null; provider_config: unknown }[] = await db.account.findMany({
    where: { company_id: companyId, is_active: true },
    select: { id: true, name: true, bank_name: true, provider_config: true },
    orderBy: { created_at: 'asc' },
  })
  const doProvedor = contas.find((c) => String((c.provider_config as { provider?: unknown } | null)?.provider ?? '').toLowerCase() === 'asaas')
  if (doProvedor) return doProvedor.id
  return contas.find((c) => /asaas|assas/i.test(`${c.name ?? ''} ${c.bank_name ?? ''}`))?.id ?? null
}

// Fix 4 (F4-B, #3/#10): conta em que entra o crédito de um pagamento Asaas — a do Payment (metadata.account_id, se for
// da empresa); senão a conta Asaas da empresa; só sem nenhuma, a da AR. É a conta onde o livro posta a linha
// ASAAS:PAY:<pay> com links [pay]: o nocional fora dela nunca seria convertido (contaria 2x).
export async function contaDoCreditoAsaas(db: any, companyId: string, metadata: unknown, contaDaAR: string | null): Promise<string | null> {
  const id = (metadata as { account_id?: unknown } | null)?.account_id
  if (typeof id === 'string' && id) {
    const conta = await db.account.findFirst({ where: { id, company_id: companyId }, select: { id: true } })
    if (conta) return conta.id
  }
  return (await contaAsaasDaEmpresa(db, companyId)) ?? contaDaAR
}

// Idem para a conta a pagar (AP:<id>, AP:<id>:estorno e linhas ligadas a AP:<id>).
export async function contasDaAP(db: any, companyId: string, ap: { id: string; account_id: string | null }): Promise<(string | null)[]> {
  const ts: { account_id: string }[] = await db.transaction.findMany({
    where: { company_id: companyId, OR: [{ bank_ref: { in: [`AP:${ap.id}`, `AP:${ap.id}:estorno`] } }, { linked_ref: `AP:${ap.id}` }] },
    select: { account_id: true },
  })
  return [ap.account_id, ...ts.map((t) => t.account_id)]
}

// Onda 4 (§3a): DESLIGA linhas do banco — sem vínculo, categoria de volta à da regra (ou ao fallback), texto do banco.
// Nunca apaga nem mexe em saldo: a linha continua sendo o dinheiro que passou pelo banco.
// Fix 2 (F2-B, #1): só a ligada pela ref PRÓPRIA (AR:<id> / AP:<id>). A de ref externa (pay_…, acquirer:…, cnab:…,
// AR:<id>:anticipation) fica: zerar o linked_ref apagaria a única marca de que ela é o dinheiro daquele evento.
export interface LinhaLigada {
  id: string
  account_id: string
  transaction_type: string
  source_text: string | null
  description: string | null
  counterparty: string | null
  linked_ref: string | null
}
export const SELECT_LINHA_LIGADA = { id: true, account_id: true, transaction_type: true, source_text: true, description: true, counterparty: true, linked_ref: true } as const
export const refPropria = (ref: string | null) => !!ref && /^(AR|AP):[^:]+$/.test(ref)

export async function desligarLinhas(tx: any, companyId: string, todas: LinhaLigada[]): Promise<void> {
  const linhas = todas.filter((l) => refPropria(l.linked_ref))
  if (linhas.length === 0) return
  const regras = await tx.classificationRule.findMany({
    where: { company_id: companyId, active: true },
    orderBy: [{ priority: 'asc' }, { created_at: 'asc' }],
  })
  const fallback: Record<string, string | null> = {
    CREDIT: await categoriaId(tx, companyId, 'Receita a identificar'),
    DEBIT: await categoriaId(tx, companyId, 'A classificar'),
  }
  for (const l of linhas) {
    const descricao = l.source_text ?? l.description ?? ''
    const porRegra = classificar(
      { chave: l.id, data: '', descricao, contraparte: l.counterparty ?? undefined, valor_centavos: l.transaction_type === 'CREDIT' ? 1 : -1 },
      regras,
      l.account_id,
    ).category_id
    await tx.transaction.update({
      where: { id: l.id },
      data: { linked_ref: null, category_id: porRegra ?? fallback[l.transaction_type] ?? null, description: l.source_text ?? l.description },
    })
  }
}
