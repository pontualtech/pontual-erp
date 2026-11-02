'use client'

import { useState } from 'react'
import type { LancamentoJaLancado } from '@/lib/financeiro/conferencia'

export type RespostaEstorno = { dinheiro: 'devolvido' } | { mover_para: string }

// Fix 10 (F10-B/F10-D): estorno de uma conta com dinheiro lançado. Quase sempre o dinheiro foi DEVOLVIDO (a saída da
// devolução chega pelo extrato; no Caixa o estorno compensa). Se foi engano, o dinheiro vai para a conta certa —
// AR: o número da OS certa; AP: uma das contas a pagar em aberto do mesmo fornecedor.
export function EstornoPerguntaDialog({ mensagem, lancados, parte, contasCertas, enviando, onEscolher, onCancelar }: {
  mensagem: string
  lancados: LancamentoJaLancado[]
  parte: 'cliente' | 'fornecedor'
  contasCertas?: { id: string; rotulo: string }[]
  enviando: boolean
  onEscolher: (resposta: RespostaEstorno) => void
  onCancelar: () => void
}) {
  const [destino, setDestino] = useState('')
  const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const data = (d: string) => d.split('-').reverse().join('/')
  const ehAR = parte === 'cliente'
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onCancelar}>
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-2">O que aconteceu com o dinheiro?</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">{mensagem}</p>
        <ul className="mb-4 space-y-1 text-sm">
          {lancados.map((l, i) => (
            <li key={i} className="rounded-lg border px-3 py-2 dark:border-gray-700">
              <span className="font-medium">{brl(l.valor_centavos)}</span> em {data(l.data)}{l.conta ? ` — ${l.conta}` : ''}
              <span className="block text-xs text-gray-500">{l.origem}</span>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => onEscolher({ dinheiro: 'devolvido' })} disabled={enviando}
          className="w-full mb-3 px-4 py-2.5 text-sm bg-amber-600 text-white rounded-xl hover:bg-amber-700 disabled:opacity-50 font-medium">
          {ehAR ? 'Dinheiro devolvido ao cliente' : 'Devolvido pelo fornecedor'}
        </button>
        <div className="rounded-xl border p-3 dark:border-gray-700">
          <label className="block text-sm font-medium mb-1">
            {ehAR ? 'Lançado na OS errada — OS certa:' : 'Lançado na conta errada — conta certa:'}
          </label>
          <div className="flex gap-2">
            {ehAR ? (
              <input value={destino} onChange={(e) => setDestino(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="nº da OS"
                className="flex-1 px-3 py-2 border rounded-xl text-sm bg-white dark:bg-gray-800 dark:border-gray-700" />
            ) : (
              <select value={destino} onChange={(e) => setDestino(e.target.value)}
                className="flex-1 px-3 py-2 border rounded-xl text-sm bg-white dark:bg-gray-800 dark:border-gray-700">
                <option value="">{(contasCertas ?? []).length === 0 ? 'nenhuma conta em aberto do fornecedor' : 'escolha a conta'}</option>
                {(contasCertas ?? []).map((c) => <option key={c.id} value={c.id}>{c.rotulo}</option>)}
              </select>
            )}
            <button type="button" onClick={() => onEscolher({ mover_para: destino })} disabled={enviando || !destino}
              className="px-4 py-2 text-sm border border-amber-600 text-amber-700 rounded-xl hover:bg-amber-50 disabled:opacity-50">
              Mover
            </button>
          </div>
        </div>
        <div className="flex justify-end mt-4">
          <button type="button" onClick={onCancelar} disabled={enviando}
            className="px-4 py-2.5 text-sm border rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800">Cancelar</button>
        </div>
      </div>
    </div>
  )
}
