// Acesso ao banco da baixa sobre o Livro-razão (a decisão pura fica em livro-baixa.ts).
// Recebe o `tx` do Prisma para rodar dentro da mesma $transaction da baixa.
import { refCnab, type CandidatoLivro, type JanelaBaixa } from './livro-baixa'
import { classificar } from './livro'
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
      linked_ref: true, origin: true, categories: { select: { name: true } },
    },
  })
  return rows.map((r) => ({
    id: r.id,
    amount: r.amount,
    transaction_type: r.transaction_type,
    transaction_date: new Date(r.transaction_date).toISOString().slice(0, 10),
    categoria: r.categories?.name ?? null,
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

// Contas onde a AR tem dinheiro (a dela + as dos lançamentos próprios e das linhas ligadas) — o que travar.
export async function contasDaAR(db: any, companyId: string, ar: { id: string; account_id: string | null; pix_code?: string | null }): Promise<(string | null)[]> {
  const r = await refsDaAR(db, companyId, ar)
  const ts: { account_id: string }[] = await db.transaction.findMany({
    where: {
      company_id: companyId,
      OR: [{ bank_ref: { in: [r.proprio, r.antecipacao, r.estorno, ...r.externos] } }, { linked_ref: { in: refsLigadasAR(r) } }],
    },
    select: { account_id: true },
  })
  return [ar.account_id, ...ts.map((t) => t.account_id)]
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
export interface LinhaLigada {
  id: string
  account_id: string
  transaction_type: string
  source_text: string | null
  description: string | null
  counterparty: string | null
}
export const SELECT_LINHA_LIGADA = { id: true, account_id: true, transaction_type: true, source_text: true, description: true, counterparty: true } as const

export async function desligarLinhas(tx: any, companyId: string, linhas: LinhaLigada[]): Promise<void> {
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
