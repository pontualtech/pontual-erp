'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { toast } from 'sonner'

interface Photo {
  id: string
  url: string
  signed_url?: string | null
  label?: string
  uploaded_by?: string
  created_at?: string
}

interface PhotoGalleryProps {
  osId: string
  customerId: string
  initialPhotos?: Photo[]
}

export function PhotoGallery({ osId, customerId, initialPhotos = [] }: PhotoGalleryProps) {
  const [photos, setPhotos] = useState<Photo[]>(initialPhotos)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { loadPhotos() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadPhotos = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/os/${osId}/photos`)
      if (res.ok) {
        const data = await res.json()
        setPhotos(data.data || [])
      }
    } catch {}
  }, [osId])

  async function handleUpload(files: FileList | File[]) {
    const fileArray = Array.from(files)
    if (fileArray.length === 0) return

    for (const file of fileArray) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name}: arquivo muito grande (max 10MB)`)
        continue
      }
      // UX-3 #5: aceita HEIC/HEIF (iPhone padrão). Backend converte via sharp.
      const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'image/heic', 'image/heif']
      const fname = (file.name || '').toLowerCase()
      const isHeicByExt = fname.endsWith('.heic') || fname.endsWith('.heif')
      const accepted = allowedMimes.includes(file.type) || isHeicByExt
      if (!accepted) {
        toast.error(
          `${file.name}: tipo não suportado. Use JPG, PNG, WEBP ou PDF.`,
          { duration: 5000 }
        )
        continue
      }
      if ((file.type === 'image/heic' || file.type === 'image/heif' || isHeicByExt)) {
        toast.info('Foto HEIC do iPhone — pode demorar mais para enviar', { duration: 3000 })
      }

      setUploading(true)
      setUploadProgress(0)

      try {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('label', 'cliente')

        const res = await fetch(`/api/portal/os/${osId}/photos`, {
          method: 'POST',
          body: formData,
        })

        const data = await res.json()

        if (!res.ok) {
          toast.error(data.error || 'Erro ao enviar arquivo')
          continue
        }

        setPhotos(prev => [data.data, ...prev])
        toast.success(`${file.name} enviado!`)
      } catch {
        toast.error('Erro de conexao ao enviar arquivo')
      }
    }

    setUploading(false)
    setUploadProgress(0)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleDelete(photoId: string) {
    if (!confirm('Excluir esta foto?')) return

    try {
      const res = await fetch(`/api/portal/os/${osId}/photos`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo_id: photoId }),
      })

      if (res.ok) {
        setPhotos(prev => prev.filter(p => p.id !== photoId))
        toast.success('Foto excluida')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Erro ao excluir')
      }
    } catch {
      toast.error('Erro de conexao')
    }
  }

  function getPhotoUrl(photo: Photo): string {
    return photo.signed_url || photo.url
  }

  function isImage(photo: Photo): boolean {
    const url = photo.url.toLowerCase()
    return url.endsWith('.jpg') || url.endsWith('.jpeg') || url.endsWith('.png') || url.endsWith('.webp')
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">Fotos e Documentos</h3>
        <span className="text-xs text-gray-500 dark:text-gray-400">{photos.length}/10</span>
      </div>

      {/* Upload zone */}
      {photos.length < 10 && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleUpload(e.dataTransfer.files) }}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors mb-4 ${
            dragOver
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
              : 'border-gray-300 dark:border-zinc-600 hover:border-blue-400 dark:hover:border-blue-600 hover:bg-gray-50 dark:hover:bg-zinc-800'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf"
            multiple
            className="hidden"
            onChange={e => e.target.files && handleUpload(e.target.files)}
          />
          {uploading ? (
            <div className="flex flex-col items-center gap-2">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-400" />
              <p className="text-sm text-blue-600 dark:text-blue-400 font-medium">Enviando...</p>
            </div>
          ) : (
            <>
              <svg className="w-8 h-8 text-gray-400 dark:text-gray-500 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                <span className="font-medium text-blue-600 dark:text-blue-400">Clique para enviar</span> ou arraste arquivos aqui
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">JPEG, PNG, WebP ou PDF (max 10MB)</p>
            </>
          )}
        </div>
      )}

      {/* Gallery grid */}
      {photos.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {photos.map(photo => (
            <div key={photo.id} className="group relative aspect-square rounded-lg overflow-hidden bg-gray-100 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700">
              {isImage(photo) ? (
                <PhotoThumb
                  src={getPhotoUrl(photo)}
                  onClick={() => setLightbox(getPhotoUrl(photo))}
                />
              ) : (
                <div
                  className="w-full h-full flex flex-col items-center justify-center cursor-pointer"
                  onClick={() => window.open(getPhotoUrl(photo), '_blank')}
                >
                  <svg className="w-10 h-10 text-red-500" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm4 18H6V4h7v5h5v11z" />
                  </svg>
                  <span className="text-xs text-gray-500 dark:text-gray-400 mt-1">PDF</span>
                </div>
              )}
              {/* Delete button (only own uploads) */}
              {photo.uploaded_by === customerId && (
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); handleDelete(photo.id) }}
                  className="absolute top-1.5 right-1.5 w-7 h-7 bg-red-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md hover:bg-red-700"
                  title="Excluir"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
              {/* Label badge */}
              {photo.label && photo.label !== 'cliente' && (
                <span className="absolute bottom-1.5 left-1.5 text-[10px] font-medium bg-black/60 text-white px-1.5 py-0.5 rounded">
                  {photo.label}
                </span>
              )}
            </div>
          ))}
        </div>
      ) : !uploading ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">Nenhuma foto enviada</p>
      ) : null}

      {/* Lightbox com zoom (UX-1 #4) */}
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  )
}

/**
 * Thumb com skeleton placeholder enquanto imagem carrega.
 * UX-3 #4: 4G fraco demora 5-10s, sem skeleton parece "sem foto".
 */
function PhotoThumb({ src, onClick }: { src: string; onClick: () => void }) {
  const [loaded, setLoaded] = useState(false)
  const [errored, setErrored] = useState(false)
  return (
    <>
      {!loaded && !errored && (
        <div className="absolute inset-0 bg-gradient-to-br from-gray-200 via-gray-300 to-gray-200 dark:from-zinc-700 dark:via-zinc-600 dark:to-zinc-700 animate-pulse" aria-hidden="true" />
      )}
      {errored ? (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400">
          ⚠ falha ao carregar
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt="Foto da OS"
          className={`w-full h-full object-cover cursor-pointer transition-all duration-300 group-hover:scale-105 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          onClick={onClick}
          onLoad={() => setLoaded(true)}
          onError={() => setErrored(true)}
          loading="lazy"
        />
      )}
    </>
  )
}

/**
 * Lightbox com zoom (1×, 2×, 3×) + pan via overflow + ESC fechar.
 * Click/double-tap na imagem cicla zoom. Pinch nativo funciona via
 * touch-action: pinch-zoom no contêiner scrollável.
 */
function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const [zoom, setZoom] = useState(1)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(3, z + 1))
      if (e.key === '-') setZoom((z) => Math.max(1, z - 1))
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  function cycleZoom() {
    setZoom((z) => (z >= 3 ? 1 : z + 1))
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Foto ampliada"
      className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Botões controle */}
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between z-10" onClick={(e) => e.stopPropagation()}>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(1, z - 1))}
            disabled={zoom <= 1}
            aria-label="Diminuir zoom"
            className="w-11 h-11 bg-white/20 rounded-full text-white text-2xl font-bold hover:bg-white/30 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(3, z + 1))}
            disabled={zoom >= 3}
            aria-label="Aumentar zoom"
            className="w-11 h-11 bg-white/20 rounded-full text-white text-2xl font-bold hover:bg-white/30 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center"
          >
            +
          </button>
          <span className="px-3 h-11 bg-white/10 rounded-full text-white text-sm font-semibold flex items-center min-w-[60px] justify-center">
            {zoom}×
          </span>
        </div>
        <button
          type="button"
          aria-label="Fechar foto"
          onClick={onClose}
          className="w-11 h-11 bg-white/20 rounded-full flex items-center justify-center text-white hover:bg-white/30"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Container com scroll quando zoom > 1 */}
      <div
        className="w-full h-full overflow-auto flex items-center justify-center p-4 touch-pinch-zoom"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt="Foto ampliada — toque para alternar zoom"
          onClick={cycleZoom}
          className={`max-w-full max-h-[90vh] object-contain rounded-lg origin-center scale-[var(--lb-zoom)] transition-transform duration-200 select-none ${zoom >= 3 ? 'cursor-zoom-out' : 'cursor-zoom-in'}`}
          style={{ ['--lb-zoom' as string]: zoom }}
          draggable={false}
        />
      </div>

      {/* Hint mobile */}
      <p className="absolute bottom-4 left-0 right-0 text-center text-white/60 text-xs px-4">
        Toque na foto para ampliar · pinch para zoom livre
      </p>
    </div>
  )
}
