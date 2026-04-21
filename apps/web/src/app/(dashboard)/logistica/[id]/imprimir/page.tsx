'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

type Stop = {
  id: string
  sequence: number
  type: 'COLETA' | 'ENTREGA'
  status: string
  customer_name: string
  customer_phone?: string | null
  address: string
  address_complement?: string | null
  os_number?: number | null
  equipment_type?: string | null
  equipment_brand?: string | null
  equipment_model?: string | null
  reported_issue?: string | null
  scheduled_window_start?: string | null
  scheduled_window_end?: string | null
  notes?: string | null
  visit_reschedule_note?: string | null
}

type RouteDetail = {
  id: string
  date: string
  status: string
  driver_name: string
  stops: Stop[]
}

function formatDate(dt: string) {
  return new Date(dt + 'T12:00:00').toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
  })
}

function formatTime(dt: string | null | undefined) {
  if (!dt) return ''
  // Campos time vem como "1970-01-01T08:00:00" — queremos so HH:mm
  const m = dt.match(/T(\d{2}:\d{2})/)
  return m ? m[1] : ''
}

function equipmentSummary(s: Stop) {
  return [s.equipment_type, s.equipment_brand, s.equipment_model].filter(Boolean).join(' ')
}

/**
 * /logistica/[id]/imprimir
 *
 * Pagina dedicada a impressao da rota. Auto-abre dialog de print no
 * carregamento. Layout A4 retrato otimizado pra motorista organizar
 * o dia com checkbox ao lado de cada parada.
 *
 * Usa @media print pra esconder controles e forcar quebra de paginas
 * a cada ~10 paradas.
 */
export default function ImprimirRotaPage() {
  const params = useParams()
  const routeId = params.id as string
  const [route, setRoute] = useState<RouteDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [autoPrint, setAutoPrint] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/logistics/routes/${routeId}`, { cache: 'no-store' })
        if (!res.ok) return
        const { data } = await res.json()
        // GET /api/logistics/routes/[id] ja enriquece stops com os_number,
        // equipment_*, reported_issue, customer_name/phone.
        const stops = (data.stops || []).sort((a: Stop, b: Stop) => a.sequence - b.sequence)
        if (!cancelled) {
          setRoute({
            id: data.id,
            date: typeof data.date === 'string' ? data.date.slice(0, 10) : data.date,
            status: data.status,
            driver_name: data.driver?.name || 'Motorista',
            stops,
          })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [routeId])

  // Auto-abrir dialogo de print quando dados carregarem
  useEffect(() => {
    if (!autoPrint || loading || !route) return
    const t = setTimeout(() => window.print(), 500)
    return () => clearTimeout(t)
  }, [autoPrint, loading, route])

  if (loading) return <div className="p-10 text-center text-gray-400">Carregando rota…</div>
  if (!route) return <div className="p-10 text-center text-red-600">Rota nao encontrada</div>

  return (
    <>
      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          @page { size: A4; margin: 1.2cm 1.2cm 1.5cm 1.2cm; }
        }
        .print-container { max-width: 18cm; margin: 0 auto; padding: 1rem; color: #111; background: white; font-family: system-ui, -apple-system, sans-serif; }
        .stop-row { page-break-inside: avoid; }
      `}</style>

      {/* Controles no topo — escondidos na impressao */}
      <div className="no-print bg-gray-100 border-b px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button
          type="button"
          onClick={() => window.print()}
          className="bg-blue-600 text-white px-4 py-2 rounded font-medium hover:bg-blue-700"
        >
          🖨️ Imprimir
        </button>
        <button
          type="button"
          onClick={() => window.close()}
          className="bg-white border px-4 py-2 rounded font-medium hover:bg-gray-50"
        >
          Fechar
        </button>
        <label className="ml-auto text-sm flex items-center gap-2">
          <input type="checkbox" checked={autoPrint} onChange={e => setAutoPrint(e.target.checked)} />
          Abrir print automaticamente
        </label>
      </div>

      <div className="print-container">
        {/* Cabecalho */}
        <header className="border-b-2 border-gray-900 pb-2 mb-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold">Rota de Entrega/Coleta</h1>
              <p className="text-sm text-gray-700 capitalize">{formatDate(route.date)}</p>
            </div>
            <div className="text-right text-sm">
              <p><strong>Motorista:</strong> {route.driver_name}</p>
              <p><strong>Total de paradas:</strong> {route.stops.length}</p>
            </div>
          </div>
        </header>

        {/* Lista de paradas */}
        <ol className="space-y-3">
          {route.stops.map((stop, idx) => (
            <li key={stop.id} className="stop-row border border-gray-300 rounded p-3 flex gap-3 text-sm">
              {/* Checkbox de concluido pra motorista marcar a lapis */}
              <div className="flex flex-col items-center pt-1">
                <div className="w-5 h-5 border-2 border-gray-700 rounded-sm" />
                <div className="text-xs font-bold mt-1">#{idx + 1}</div>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${stop.type === 'COLETA' ? 'bg-purple-200' : 'bg-emerald-200'}`}>
                    {stop.type}
                  </span>
                  {stop.os_number ? (
                    <span className="text-xs font-mono text-gray-600">OS #{stop.os_number}</span>
                  ) : null}
                  {stop.scheduled_window_start || stop.scheduled_window_end ? (
                    <span className="text-xs text-gray-600">
                      Janela: {formatTime(stop.scheduled_window_start)}{stop.scheduled_window_end ? ` — ${formatTime(stop.scheduled_window_end)}` : ''}
                    </span>
                  ) : null}
                </div>

                <div className="font-semibold text-gray-900">
                  {stop.customer_name || 'Cliente'}
                  {stop.customer_phone ? <span className="font-normal text-gray-600"> · {stop.customer_phone}</span> : null}
                </div>

                <div className="text-gray-800 leading-snug">
                  {stop.address}
                  {stop.address_complement ? ` — ${stop.address_complement}` : ''}
                </div>

                {equipmentSummary(stop) ? (
                  <div className="text-xs text-gray-600 mt-0.5">
                    <strong>Equipamento:</strong> {equipmentSummary(stop)}
                  </div>
                ) : null}

                {stop.reported_issue ? (
                  <div className="text-xs text-gray-600 italic mt-0.5">
                    <strong>Problema:</strong> {stop.reported_issue}
                  </div>
                ) : null}

                {stop.notes ? (
                  <div className="text-xs text-gray-700 mt-1 bg-gray-50 px-2 py-1 rounded">
                    📝 {stop.notes}
                  </div>
                ) : null}

                {stop.visit_reschedule_note ? (
                  <div className="text-xs text-amber-700 mt-1 bg-amber-50 px-2 py-1 rounded">
                    ⚠️ Adiada: {stop.visit_reschedule_note}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ol>

        {/* Rodape com assinaturas */}
        <footer className="mt-8 pt-4 border-t text-sm grid grid-cols-2 gap-8">
          <div>
            <div className="border-b border-gray-700 h-8" />
            <p className="text-xs text-gray-600 mt-1">Assinatura do motorista</p>
          </div>
          <div>
            <div className="border-b border-gray-700 h-8" />
            <p className="text-xs text-gray-600 mt-1">Data / Hora de saida</p>
          </div>
        </footer>
      </div>
    </>
  )
}
