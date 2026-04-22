'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, Camera, ScanLine, Check, Plus, X, Loader2 } from 'lucide-react'
import SignatureCanvas from '../../../components/signature-canvas'
import OcrScanner from '../../../components/ocr-scanner'
import CameraCapture from '../../../components/camera-capture'
import { enqueueSubmission } from '../../../lib/offline-queue'

// Checklist padrão — o que o motorista sempre precisa conferir.
// Cada item tem key (identifier estável) + label (o que o motorista vê).
const CHECKLIST_ITEMS = [
  { key: 'cables',         label: 'Cabos (força, USB, rede)' },
  { key: 'power_supply',   label: 'Fonte / adaptador' },
  { key: 'paper_tray',     label: 'Bandeja de papel' },
  { key: 'leaks',          label: 'Vazamentos de tinta' },
  { key: 'broken_parts',   label: 'Peças quebradas' },
  { key: 'bad_condition',  label: 'Mau estado geral' },
]

type StopData = {
  id: string
  customer_name: string
  address: string
  type?: string
  status?: string
  serial_number?: string | null
  serial_source?: string | null
  checklist?: Array<{ key: string; label: string; checked: boolean }> | null
  observations?: string | null
  signer_name?: string | null
  signature_url?: string | null
  photo_urls?: string[] | null
  completed_at?: string | null
  os: { id: string; number: number; equipment: string; reported_issue: string | null } | null
}

function uuidv4() {
  // Pequena implementação de uuid v4 (não depende de lib).
  // crypto.randomUUID() existe em browsers modernos; fallback se falhar.
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export default function ColetaPage() {
  const router = useRouter()
  const { stopId } = useParams<{ stopId: string }>()

  const [stop, setStop] = useState<StopData | null>(null)
  const [loading, setLoading] = useState(true)

  const [checklist, setChecklist] = useState(
    CHECKLIST_ITEMS.map(i => ({ ...i, checked: false }))
  )
  const [serial, setSerial] = useState('')
  const [serialSource, setSerialSource] = useState<'manual' | 'ocr' | 'ocr_corrected'>('manual')
  const [observations, setObservations] = useState('')
  const [signerName, setSignerName] = useState('')
  const [signaturePng, setSignaturePng] = useState<string | null>(null)
  const [extraPhotos, setExtraPhotos] = useState<string[]>([])

  const [ocrOpen, setOcrOpen] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Extra-OS modal: motorista cria OS adicional quando cliente entrega
  // equipamento nao cadastrado no momento da coleta
  const [extraModal, setExtraModal] = useState(false)
  const [extraForm, setExtraForm] = useState({
    equipment_type: '', equipment_brand: '', equipment_model: '',
    serial_number: '', reported_issue: '',
  })
  const [creatingExtra, setCreatingExtra] = useState(false)
  const [extrasCreated, setExtrasCreated] = useState<number[]>([])

  // Fetch stop data — usa /api/driver/stop/[id] que retorna TODOS os
  // campos (serial, checklist, assinatura, etc) pra suportar EDICAO
  // quando a coleta ja foi finalizada.
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/driver/stop/${stopId}`, { cache: 'no-store' })
        if (!res.ok) { toast.error('Parada nao encontrada'); router.back(); return }
        const { data } = await res.json()
        if (data.type !== 'COLETA') { toast.error('Essa parada nao e coleta'); router.back(); return }

        // Complementa com dados de OS da rota/hoje (pra mostrar problema, equipamento)
        try {
          const rotaRes = await fetch('/api/driver/rota/hoje', { cache: 'no-store' })
          const { data: rotaData } = await rotaRes.json()
          const rotaStop = (rotaData.stops || []).find((s: any) => s.id === stopId)
          if (rotaStop?.os) (data as any).os = rotaStop.os
        } catch {}

        setStop(data)

        // Se ja foi finalizada (COMPLETED), pre-carrega campos pra edicao
        if (data.status === 'COMPLETED') {
          if (data.serial_number) setSerial(data.serial_number)
          if (data.serial_source) setSerialSource(data.serial_source as any)
          if (data.observations) setObservations(data.observations)
          if (data.signer_name) setSignerName(data.signer_name)
          if (Array.isArray(data.checklist) && data.checklist.length > 0) {
            setChecklist(data.checklist as any)
          }
          // photo_urls[0] e assinatura, resto sao fotos extras
          if (Array.isArray(data.photo_urls) && data.photo_urls.length > 0) {
            const [sig, ...extras] = data.photo_urls as string[]
            if (sig?.startsWith('data:image/png')) setSignaturePng(sig)
            // Extras sao data:URL — convertemos pra base64 puro
            const extraBase64s = extras
              .filter(u => typeof u === 'string' && u.startsWith('data:image/jpeg'))
              .map(u => u.replace(/^data:image\/jpeg;base64,/, ''))
            setExtraPhotos(extraBase64s)
          }
          toast.info('Coleta ja finalizada — editando dados')
        }
      } catch {
        toast.error('Falha ao carregar')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [stopId, router])

  function toggleItem(key: string) {
    setChecklist(prev => prev.map(i => i.key === key ? { ...i, checked: !i.checked } : i))
  }

  async function handleOcrResult({ serial: s, photoBase64, source }: { serial: string | null; photoBase64: string; source: 'ocr' | 'manual' }) {
    if (s) {
      setSerial(s)
      setSerialSource('ocr')
      toast.success(`S/N lido: ${s}`)
    } else {
      toast.info('Não consegui ler — digite manualmente')
    }
    // Salva a foto do OCR automaticamente — motorista fotografou a etiqueta
    // do equipamento, essa foto vira evidencia do cadastro (numero de serie,
    // modelo, estado da placa). Independente do OCR ter sucesso ou nao, a
    // foto fica salva como anexo da coleta.
    if (photoBase64) {
      setExtraPhotos(prev => [...prev, photoBase64])
    }
    setOcrOpen(false)
  }

  async function handleCreateExtraOs() {
    if (!extraForm.equipment_type.trim()) return toast.error('Informe o tipo do equipamento')
    if (!extraForm.reported_issue.trim()) return toast.error('Descreva o problema relatado')
    setCreatingExtra(true)
    try {
      const res = await fetch(`/api/driver/stop/${stopId}/extra-os`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(extraForm),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(body.error || 'Falha ao criar OS extra'); return }
      const newNumber = body.data?.os?.number
      toast.success(`OS #${newNumber} criada! Adicionada ao fim da rota pra voce coletar junto.`)
      if (newNumber) setExtrasCreated(prev => [...prev, newNumber])
      setExtraModal(false)
      setExtraForm({ equipment_type: '', equipment_brand: '', equipment_model: '', serial_number: '', reported_issue: '' })
    } catch { toast.error('Erro de conexao') }
    finally { setCreatingExtra(false) }
  }

  async function getCurrentLocation(): Promise<{ lat: number; lng: number } | null> {
    return new Promise(resolve => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null)
      navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 30_000 }
      )
    })
  }

  async function finalizar() {
    if (!serial.trim()) return toast.error('Informe o número de série')
    if (!signaturePng) return toast.error('Peça a assinatura do cliente')
    if (!signerName.trim()) return toast.error('Informe quem assinou')

    setSubmitting(true)
    try {
      const isEditing = stop?.status === 'COMPLETED'

      // Se assinatura veio de uma data-URL pre-carregada, reextrai o base64;
      // se for assinatura nova do SignatureCanvas, tambem vem como data:url
      const sigBase64 = signaturePng.replace(/^data:image\/png;base64,/, '')

      // Se editando, extraPhotos tem base64 puro (removemos prefix no load)
      // Se novo, extraPhotos tem base64 puro direto do CameraCapture
      const photosBase64 = extraPhotos

      if (isEditing) {
        // Modo EDICAO: PATCH simples, sem offline queue (ja ta COMPLETED,
        // cliente ja foi notificado, OS ja transicionou — so corrige campos)
        const res = await fetch(`/api/driver/stop/${stopId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serial_number: serial.trim().toUpperCase(),
            serial_source: serialSource,
            checklist,
            observations: observations.trim() || null,
            signature_png_base64: sigBase64,
            signer_name: signerName.trim(),
            photos_base64: photosBase64,
          }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          toast.error(body.error || 'Erro ao salvar alteracoes')
          return
        }
        toast.success('Alteracoes salvas!')
        router.replace('/motorista/rota')
      } else {
        // Modo FINALIZAR: POST com offline queue + notificacoes
        const location = await getCurrentLocation()
        const payload = {
          event_id: uuidv4(),
          serial_number: serial.trim().toUpperCase(),
          serial_source: serialSource,
          checklist,
          observations: observations.trim() || null,
          signature_png_base64: sigBase64,
          signer_name: signerName.trim(),
          photos_base64: photosBase64,
          location,
        }
        await enqueueSubmission(`/api/driver/stop/${stopId}/coleta`, payload)
        toast.success('Coleta registrada! Sincronizando…')
        router.replace('/motorista/rota')
      }
    } catch (err) {
      toast.error('Erro ao salvar. Tente novamente.')
    } finally { setSubmitting(false) }
  }

  if (loading) {
    return <div className="flex min-h-[100dvh] items-center justify-center">
      <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
    </div>
  }
  if (!stop) return null
  if (ocrOpen) return <OcrScanner onResult={handleOcrResult} onCancel={() => setOcrOpen(false)} />
  if (cameraOpen) return <CameraCapture
    hint="Foto do estado do equipamento"
    onCapture={b => { setExtraPhotos(p => [...p, b]); setCameraOpen(false) }}
    onCancel={() => setCameraOpen(false)} />

  return (
    <div className="min-h-[100dvh] bg-slate-50">
      <header className={`sticky top-0 ${stop.status === 'COMPLETED' ? 'bg-amber-600' : 'bg-purple-700'} text-white px-4 py-3 flex items-center gap-3 shadow z-10`}>
        <button type="button" onClick={() => router.back()} aria-label="Voltar" className="p-1"><ArrowLeft className="w-6 h-6" /></button>
        <div className="flex-1 min-w-0">
          <h1 className="font-bold leading-tight truncate">
            {stop.status === 'COMPLETED' ? '✏️ Editando Coleta' : 'Coleta'} — {stop.customer_name}
          </h1>
          <p className="text-xs opacity-80 truncate">{stop.os ? `OS #${stop.os.number}` : ''} {stop.os?.equipment}</p>
        </div>
      </header>

      <main className="p-4 space-y-4 pb-32">
        {stop.os?.reported_issue && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
            <strong className="block text-xs uppercase text-amber-700 mb-1">Defeito relatado</strong>
            {stop.os.reported_issue}
          </div>
        )}

        <section>
          <h2 className="font-semibold text-gray-900 mb-2">Checklist do equipamento</h2>
          <div className="bg-white rounded-xl border divide-y">
            {checklist.map(item => (
              <label key={item.key} className="flex items-center gap-3 px-4 py-3 active:bg-gray-50">
                <input type="checkbox" checked={item.checked} onChange={() => toggleItem(item.key)}
                  className="w-5 h-5 accent-purple-600" />
                <span className="flex-1">{item.label}</span>
              </label>
            ))}
          </div>
        </section>

        <section>
          <h2 className="font-semibold text-gray-900 mb-2">Número de série</h2>
          <div className="flex gap-2">
            <input value={serial}
              onChange={e => { setSerial(e.target.value); if (serialSource === 'ocr') setSerialSource('ocr_corrected') }}
              placeholder="Ex: X8PK291847" autoCapitalize="characters"
              className="flex-1 border border-gray-300 rounded-lg px-4 py-3 bg-white" />
            <button onClick={() => setOcrOpen(true)}
              className="bg-blue-600 text-white px-4 rounded-lg flex items-center gap-1.5 active:scale-95">
              <ScanLine className="w-5 h-5" /> OCR
            </button>
          </div>
          {serialSource === 'ocr' && <p className="text-xs text-blue-600 mt-1">✓ Lido via câmera</p>}
          {serialSource === 'ocr_corrected' && <p className="text-xs text-amber-600 mt-1">✎ OCR editado manualmente</p>}
        </section>

        <section>
          <h2 className="font-semibold text-gray-900 mb-2">Observações <span className="text-xs font-normal text-gray-500">(opcional)</span></h2>
          <textarea value={observations} onChange={e => setObservations(e.target.value)}
            rows={3} placeholder="Ex: cliente reportou ruído ao ligar"
            className="w-full border border-gray-300 rounded-lg px-4 py-3 bg-white" />
        </section>

        <section>
          <h2 className="font-semibold text-gray-900 mb-2">Fotos extras <span className="text-xs font-normal text-gray-500">(opcional)</span></h2>
          <div className="grid grid-cols-3 gap-2">
            {extraPhotos.map((p, i) => (
              <div key={i} className="relative aspect-square bg-gray-100 rounded-lg overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`data:image/jpeg;base64,${p}`} alt="" className="w-full h-full object-cover" />
                <button onClick={() => setExtraPhotos(prev => prev.filter((_, idx) => idx !== i))}
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-xs">×</button>
              </div>
            ))}
            <button onClick={() => setCameraOpen(true)}
              className="aspect-square border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center text-gray-500 active:bg-gray-50">
              <Camera className="w-6 h-6" />
              <span className="text-xs mt-1">Adicionar</span>
            </button>
          </div>
        </section>

        <section>
          <div className="rounded-xl border-2 border-dashed border-blue-300 bg-blue-50 p-4">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <h2 className="font-semibold text-blue-900">Cliente entregou outra maquina?</h2>
                <p className="text-xs text-blue-700 mt-0.5">
                  Crie uma OS extra pro mesmo cliente sem voltar ao escritorio. Vai direto pra sua rota.
                </p>
                {extrasCreated.length > 0 && (
                  <p className="text-xs text-green-700 font-semibold mt-1.5">
                    ✓ {extrasCreated.length} OS extra{extrasCreated.length > 1 ? 's' : ''} criada{extrasCreated.length > 1 ? 's' : ''}: {extrasCreated.map(n => `#${n}`).join(', ')}
                  </p>
                )}
              </div>
              <button type="button" onClick={() => setExtraModal(true)}
                className="bg-blue-600 text-white text-sm font-bold px-3 py-2 rounded-lg flex items-center gap-1 active:scale-95 shrink-0">
                <Plus className="w-4 h-4" /> Criar OS
              </button>
            </div>
          </div>
        </section>

        <section>
          <h2 className="font-semibold text-gray-900 mb-2">Assinatura do cliente</h2>
          <input value={signerName} onChange={e => setSignerName(e.target.value)}
            placeholder="Nome de quem está assinando"
            className="w-full border border-gray-300 rounded-lg px-4 py-3 bg-white mb-2" />
          <SignatureCanvas onChange={setSignaturePng} />
        </section>
      </main>

      {/* Modal: criar OS extra */}
      {extraModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60"
          onClick={() => !creatingExtra && setExtraModal(false)}>
          <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-lg flex items-center gap-2 text-blue-700">
                <Plus className="w-5 h-5" />
                Nova OS em campo
              </h3>
              <button type="button" onClick={() => setExtraModal(false)} disabled={creatingExtra}
                className="text-gray-400 hover:text-gray-600 p-1" aria-label="Fechar">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Cliente <strong>{stop.customer_name}</strong> — essa OS entra na sua rota automaticamente.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">
                  Tipo de equipamento *
                </label>
                <input value={extraForm.equipment_type}
                  onChange={e => setExtraForm(f => ({ ...f, equipment_type: e.target.value }))}
                  placeholder="Ex: Impressora, Notebook, Monitor"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base" />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Marca</label>
                  <input value={extraForm.equipment_brand}
                    onChange={e => setExtraForm(f => ({ ...f, equipment_brand: e.target.value }))}
                    placeholder="Ex: HP, Epson"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Modelo</label>
                  <input value={extraForm.equipment_model}
                    onChange={e => setExtraForm(f => ({ ...f, equipment_model: e.target.value }))}
                    placeholder="Ex: L3150"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">
                  Numero de serie <span className="font-normal lowercase text-gray-400">(opcional)</span>
                </label>
                <input value={extraForm.serial_number}
                  onChange={e => setExtraForm(f => ({ ...f, serial_number: e.target.value }))}
                  placeholder="Voce pode adicionar depois"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">
                  Problema relatado *
                </label>
                <textarea value={extraForm.reported_issue}
                  onChange={e => setExtraForm(f => ({ ...f, reported_issue: e.target.value }))}
                  placeholder="Ex: nao liga, imprime com falha, faz barulho..."
                  rows={3}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none" />
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button type="button" onClick={() => setExtraModal(false)} disabled={creatingExtra}
                className="flex-1 rounded-lg border px-4 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50 active:scale-[0.99]">
                Cancelar
              </button>
              <button type="button" onClick={handleCreateExtraOs} disabled={creatingExtra}
                className="flex-[2] rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50 active:scale-[0.99] flex items-center justify-center gap-2">
                {creatingExtra && <Loader2 className="w-4 h-4 animate-spin" />}
                Criar e adicionar a rota
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t shadow-lg"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
        <button type="button" onClick={finalizar} disabled={submitting}
          className={`w-full text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.99] transition ${stop.status === 'COMPLETED' ? 'bg-amber-600' : 'bg-green-600'}`}>
          {submitting ? (
            <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
          ) : (
            <><Check className="w-5 h-5" /> {stop.status === 'COMPLETED' ? 'Salvar Alteracoes' : 'Finalizar Coleta'}</>
          )}
        </button>
      </div>
    </div>
  )
}
