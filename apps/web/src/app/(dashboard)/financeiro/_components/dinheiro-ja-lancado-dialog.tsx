'use client'

import type { LancamentoJaLancado } from '@/lib/financeiro/conferencia'

// Fix 7 (F7-D): Receber de uma conta que já tem dinheiro lançado — o operador diz se é outro pagamento ou o mesmo.
export function DinheiroJaLancadoDialog({ mensagem, lancados, enviando, onEscolher, onCancelar }: {
  mensagem: string
  lancados: LancamentoJaLancado[]
  enviando: boolean
  onEscolher: (dinheiro: 'novo' | 'mesmo') => void
  onCancelar: () => void
}) {
  const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const data = (d: string) => d.split('-').reverse().join('/')
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onCancelar}>
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-2">Esta conta já tem dinheiro lançado</h2>
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
          <button type="button" onClick={() => onEscolher('mesmo')} disabled={enviando}
            className="px-4 py-2.5 text-sm border border-emerald-600 text-emerald-700 rounded-xl hover:bg-emerald-50 disabled:opacity-50">
            É o mesmo dinheiro — só marcar recebida
          </button>
          <button type="button" onClick={() => onEscolher('novo')} disabled={enviando}
            className="px-4 py-2.5 text-sm bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:opacity-50 font-medium">
            É um novo pagamento — lançar
          </button>
        </div>
      </div>
    </div>
  )
}
