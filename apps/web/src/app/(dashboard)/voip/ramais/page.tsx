'use client'

import { useEffect, useState } from 'react'
import { Phone, User, Hash, Mail, Loader2, RefreshCw } from 'lucide-react'
import { CallButton } from '@/components/voip/CallButton'

interface Extension {
  ramal: string
  email: string
  name: string
  role: string | null
  phone: string | null
  userId: string | null
  lastLoginAt: string | null
}

function roleLabel(role: string | null): string {
  if (!role) return ''
  const map: Record<string, string> = {
    admin: 'Administrador',
    atendente: 'Atendente',
    tecnico: 'Tecnico',
    financeiro: 'Financeiro',
    vendedor: 'Vendedor',
    motorista: 'Motorista',
  }
  return map[role.toLowerCase()] || role
}

export default function VoipRamaisPage() {
  const [extensions, setExtensions] = useState<Extension[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  function load() {
    setLoading(true)
    setError('')
    fetch('/api/voip/extensions', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        if (d.error) {
          setError(typeof d.error === 'string' ? d.error : (d.error?.message || 'Erro'))
          return
        }
        setExtensions(d.data || [])
      })
      .catch(() => setError('Erro ao carregar ramais'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Hash className="h-6 w-6 text-blue-600" />
          Ramais SIP
        </h1>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md hover:bg-gray-50"
        >
          <RefreshCw className="h-4 w-4" /> Atualizar
        </button>
      </div>

      <p className="text-sm text-gray-500">
        Para chamar outro funcionário internamente, disque o número do ramal abaixo no widget Sonax (canto direito).
        Cada ramal toca no usuário logado correspondente.
      </p>

      <div className="rounded-lg border bg-white shadow-sm">
        {loading && (
          <div className="py-12 text-center text-gray-400">
            <Loader2 className="h-6 w-6 animate-spin inline-block" />
            <p className="mt-2 text-sm">Carregando...</p>
          </div>
        )}
        {error && <div className="p-6 text-center text-red-600">{error}</div>}
        {!loading && !error && extensions.length === 0 && (
          <div className="py-12 text-center text-gray-400">
            <p className="text-sm">Nenhum ramal cadastrado no SONAX_RAMAL_MAPPING</p>
          </div>
        )}
        {!loading && !error && extensions.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <th className="px-4 py-3">Ramal</th>
                  <th className="px-4 py-3">Funcionário</th>
                  <th className="px-4 py-3">Função</th>
                  <th className="px-4 py-3">E-mail (login)</th>
                  <th className="px-4 py-3">Celular</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {extensions.map(e => (
                  <tr key={e.ramal} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center justify-center px-3 py-1 rounded-md bg-blue-100 text-blue-700 font-mono font-semibold text-base">
                        {e.ramal}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-full bg-gray-100 flex items-center justify-center">
                          <User className="h-4 w-4 text-gray-500" />
                        </div>
                        <span className="font-medium text-gray-900">{e.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{roleLabel(e.role)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 text-gray-600">
                        <Mail className="h-3 w-3" />
                        <span className="text-xs font-mono">{e.email}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700 font-mono text-xs">
                      {e.phone || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <CallButton phoneNumber={e.ramal} variant="compact" label={`Disc ${e.ramal}`} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-blue-50 p-4 text-sm text-blue-900">
        <p className="font-semibold mb-1 flex items-center gap-1.5">
          <Phone className="h-4 w-4" /> Como funciona
        </p>
        <ul className="space-y-1 text-blue-800 list-disc list-inside">
          <li>Cada funcionário faz login no ERP com seu e-mail e o widget Sonax aparece com o ramal dele</li>
          <li>Para ligar pra outro funcionário, abra o widget e disque o número do ramal (3 dígitos)</li>
          <li>Para receber chamadas, basta estar logado e com o widget aberto (microfone permitido)</li>
        </ul>
      </div>
    </div>
  )
}
