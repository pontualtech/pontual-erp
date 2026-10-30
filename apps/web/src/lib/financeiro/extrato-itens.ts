/** Mapeia uma Transaction (com categories) para o item do extrato. Puro. */
export interface TransacaoExtratoRow {
  id: string
  amount: number
  transaction_type: string
  description: string | null
  bank_ref: string | null
  reconciled: boolean
  transaction_date: Date | null
  category_id: string | null
  origin: string | null
  source_text: string | null
  created_at: Date | null
  categories: { name: string } | null
}

export function itemDeTransacao(t: TransacaoExtratoRow, contaNome: string) {
  return {
    id: t.id,
    data: t.transaction_date ? new Date(t.transaction_date).toISOString() : '',
    descricao: t.description || `Transação ${t.bank_ref || ''}`,
    entidade: '—',
    conta_bancaria: contaNome,
    centro_custo: '—',
    categoria: t.categories?.name || '—',
    category_id: t.category_id ?? null,
    forma_pagamento: '—',
    valor: t.amount,
    tipo: (t.transaction_type === 'CREDIT' ? 'ENTRADA' : 'SAIDA') as 'ENTRADA' | 'SAIDA',
    origem: 'transacao' as const,
    status: t.reconciled ? 'CONCILIADO' : 'NAO_CONCILIADO',
    reconciliado: t.reconciled,
    livro: t.origin === 'BANCO',
    texto_banco: t.source_text ?? null,
    criado_em: t.created_at ? new Date(t.created_at).toISOString() : null,
  }
}
