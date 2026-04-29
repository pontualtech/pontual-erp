'use client'

import { useState } from 'react'
import { Loader2, Search } from 'lucide-react'

/**
 * Formulario de endereco com auto-preenchimento por CEP (ViaCEP).
 *
 * - Usuario digita CEP -> onBlur / 8 digitos -> GET viacep.com.br
 * - Rua, bairro, cidade, UF preenchem automaticamente (editaveis)
 * - Numero e complemento ficam com o usuario
 * - onChange entrega um objeto com o endereco estruturado E uma string
 *   formatada pronta pra gravar no `address` do backend
 */

export type AddressParts = {
  cep: string
  street: string
  number: string
  complement: string
  neighborhood: string
  city: string
  state: string
}

export function buildFullAddress(a: AddressParts): string {
  const parts = [
    a.street,
    a.number,
    a.complement,
    a.neighborhood,
    a.city && a.state ? `${a.city}/${a.state}` : (a.city || a.state),
    a.cep ? `CEP ${a.cep}` : '',
  ].filter(Boolean)
  return parts.join(', ')
}

type Props = {
  value: AddressParts
  onChange: (next: AddressParts) => void
  compact?: boolean
}

export default function CepAddressForm({ value, onChange, compact }: Props) {
  const [looking, setLooking] = useState(false)
  const [cepError, setCepError] = useState<string | null>(null)

  function maskCep(raw: string): string {
    const digits = raw.replace(/\D/g, '').slice(0, 8)
    if (digits.length <= 5) return digits
    return `${digits.slice(0, 5)}-${digits.slice(5)}`
  }

  async function lookup(cepRaw: string) {
    const digits = cepRaw.replace(/\D/g, '')
    if (digits.length !== 8) return
    setLooking(true)
    setCepError(null)
    try {
      // Usa endpoint interno /api/consulta/cep — o CSP do app bloqueia
      // chamadas diretas pra viacep.com.br no browser. O endpoint interno
      // faz proxy server-side com cache 24h.
      const res = await fetch(`/api/consulta/cep/${digits}`)
      if (res.status === 404) { setCepError('CEP nao encontrado'); return }
      if (!res.ok) { setCepError('CEP invalido'); return }
      const j = await res.json()
      const data = j.data || {}
      onChange({
        ...value,
        cep: maskCep(digits),
        street: data.address_street || value.street,
        neighborhood: data.address_neighborhood || value.neighborhood,
        city: data.address_city || value.city,
        state: (data.address_state || value.state).toUpperCase(),
      })
    } catch {
      setCepError('Falha na busca do CEP')
    } finally {
      setLooking(false)
    }
  }

  const inputCls = `w-full border border-gray-300 rounded-lg px-3 ${compact ? 'py-2' : 'py-2.5'} text-sm`
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div className="space-y-3">
      {/* CEP + Buscar */}
      <div>
        <label className={labelCls}>CEP *</label>
        <div className="flex gap-2">
          <input
            type="text"
            inputMode="numeric"
            value={value.cep}
            onChange={e => onChange({ ...value, cep: maskCep(e.target.value) })}
            onBlur={e => lookup(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); lookup(value.cep) } }}
            placeholder="00000-000"
            maxLength={9}
            className={`flex-1 ${inputCls}`}
          />
          <button type="button" onClick={() => lookup(value.cep)}
            disabled={looking || value.cep.replace(/\D/g, '').length !== 8}
            className="px-3 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 active:scale-95 flex items-center gap-1">
            {looking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          </button>
        </div>
        {cepError && <p className="text-[11px] text-red-600 mt-1">{cepError}</p>}
        {!cepError && !value.cep && (
          <p className="text-[10px] text-gray-400 mt-1">Digite o CEP que o endereco preenche sozinho</p>
        )}
      </div>

      {/* Rua */}
      <div>
        <label className={labelCls}>Rua / Avenida *</label>
        <input type="text" value={value.street}
          onChange={e => onChange({ ...value, street: e.target.value })}
          placeholder="Rua / Avenida"
          className={inputCls} />
      </div>

      {/* Numero + Complemento */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls}>Numero *</label>
          <input type="text" inputMode="numeric" value={value.number}
            onChange={e => onChange({ ...value, number: e.target.value })}
            placeholder="123"
            className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Complemento</label>
          <input type="text" value={value.complement}
            onChange={e => onChange({ ...value, complement: e.target.value })}
            placeholder="Sala, apto, bloco..."
            className={inputCls} />
        </div>
      </div>

      {/* Bairro */}
      <div>
        <label className={labelCls}>Bairro</label>
        <input type="text" value={value.neighborhood}
          onChange={e => onChange({ ...value, neighborhood: e.target.value })}
          placeholder="Bairro"
          className={inputCls} />
      </div>

      {/* Cidade + UF */}
      <div className="grid grid-cols-[1fr_80px] gap-2">
        <div>
          <label className={labelCls}>Cidade</label>
          <input type="text" value={value.city}
            onChange={e => onChange({ ...value, city: e.target.value })}
            placeholder="Cidade"
            className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>UF</label>
          <input type="text" maxLength={2} value={value.state}
            onChange={e => onChange({ ...value, state: e.target.value.toUpperCase() })}
            placeholder="SP"
            className={inputCls + ' uppercase'} />
        </div>
      </div>
    </div>
  )
}

export const EMPTY_ADDRESS: AddressParts = {
  cep: '', street: '', number: '', complement: '',
  neighborhood: '', city: '', state: '',
}
