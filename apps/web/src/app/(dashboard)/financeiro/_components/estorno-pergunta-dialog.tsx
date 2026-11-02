'use client'

import type { LancamentoJaLancado } from '@/lib/financeiro/conferencia'

// Fix 8 (F8-A, §0): estorno de uma conta com dinheiro lançado — o operador diz se o dinheiro voltou para o
// cliente/fornecedor (só status; a devolução chega pelo extrato) ou continua no banco (engano: compensa).
export function EstornoPerguntaDialog({ mensagem, lancados, parte, enviando, onEscolher, onCancelar }: {
  mensagem: string
  lancados: LancamentoJaLancado[]
  parte: 'cliente' | 'fornecedor'
  enviando: boolean
  onEscolher: (dinheiro: 'devolvido' | 'permanece') => void
  onCancelar: () => void
}) {
  const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const data = (d: string) => d.split('-').reverse().join('/')
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onCancelar}>
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-2">Onde está o dinheiro?</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">{mensagem}</p>
        <ul className="mb-4 space-y-1 text-sm">
          {lancados.map((l, i) => (
            <li key={i} className="rounded-lg border px-3 py-2 dark:border-gray-700">
              <span className="font-medium">{brl(l.valor_centavos)}</span> em {data(l.data)}{l.conta ? ` — ${l.conta}` : ''}
              <span className="block text-xs text-gray-500">{l.origem}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancelar} disabled={enviando}
            className="px-4 py-2.5 text-sm border rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800">Cancelar</button>
          <button type="button" onClick={() => onEscolher('devolvido')} disabled={enviando}
            className="px-4 py-2.5 text-sm border border-amber-600 text-amber-700 rounded-xl hover:bg-amber-50 disabled:opacity-50">
            {parte === 'cliente' ? 'Voltou para o cliente' : 'Voltou do fornecedor'}
          </button>
          <button type="button" onClick={() => onEscolher('permanece')} disabled={enviando}
            className="px-4 py-2.5 text-sm bg-amber-600 text-white rounded-xl hover:bg-amber-700 disabled:opacity-50 font-medium">
            Continua no banco (foi engano)
          </button>
        </div>
      </div>
    </div>
  )
}
