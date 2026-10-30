// Acesso ao banco da baixa sobre o Livro-razão (a decisão pura fica em livro-baixa.ts).
// Recebe o `tx` do Prisma para rodar dentro da mesma $transaction da baixa.
import { JANELA_BAIXA, type CandidatoLivro } from './livro-baixa'

const DIA_MS = 86_400_000

// Data de hoje em America/Sao_Paulo como 'AAAA-MM-DD' (en-CA já formata assim).
export function hojeSP(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
}

// Lançamentos do livro (origin BANCO) da MESMA conta dentro da janela em torno de `data`;
// o lançamento escolhido explicitamente entra mesmo fora da janela. `categoria` = nome da categoria.
export async function candidatosLivro(
  tx: any,
  companyId: string,
  accountId: string,
  tipo: 'CREDIT' | 'DEBIT',
  data: string,
  explicito: string | null,
): Promise<CandidatoLivro[]> {
  const base = Date.parse(`${data}T00:00:00Z`)
  const janela = {
    transaction_date: {
      gte: new Date(base - JANELA_BAIXA.antes * DIA_MS),
      lte: new Date(base + JANELA_BAIXA.depois * DIA_MS),
    },
  }
  const rows: any[] = await tx.transaction.findMany({
    where: {
      company_id: companyId,
      account_id: accountId,
      transaction_type: tipo,
      origin: 'BANCO',
      OR: explicito ? [janela, { id: explicito }] : [janela],
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
