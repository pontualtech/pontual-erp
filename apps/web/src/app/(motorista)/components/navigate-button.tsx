'use client'

import { useEffect, useState } from 'react'
import { Navigation } from 'lucide-react'

/**
 * UX-4 #6: action sheet de navegação. Motorista escolhe entre Waze, Google
 * Maps ou Apple Maps via deeplink. iOS Safari respeita os schemes.
 *
 * Antes: hardcode `https://www.google.com/maps/dir/?api=1&destination=...`
 * → Chrome abria Maps universal, ignorando preferência do motorista (BR
 * prefere Waze por alertas de polícia/trânsito).
 */
export function NavigateButton({ lat, lng, label = 'Navegar', compact = false }: {
  lat: number
  lng: number
  label?: string
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [isIOS, setIsIOS] = useState(false)

  useEffect(() => {
    if (typeof navigator !== 'undefined') {
      setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1))
    }
  }, [])

  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (!target.closest('[data-navigate-button]')) setOpen(false)
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [open])

  const wazeUrl = `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`
  const googleUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`
  const appleUrl = `http://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`
  // Deeplink Google Maps no iOS abre app se instalado
  const googleIosUrl = `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving`

  const buttonClass = compact
    ? 'inline-flex items-center gap-1.5 text-sm bg-green-50 text-green-700 px-3 py-1.5 rounded-full font-medium active:scale-95 min-h-[40px]'
    : 'inline-flex items-center gap-1.5 text-sm bg-green-50 text-green-700 px-3 py-1.5 rounded-full font-medium active:scale-95 min-h-[40px]'

  return (
    <span className="relative inline-block" data-navigate-button>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(!open) }}
        className={buttonClass}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Navigation className="w-3.5 h-3.5" /> {label}
      </button>

      {open && (
        <span
          role="menu"
          className="absolute left-0 top-full mt-1 z-30 min-w-[180px] rounded-xl bg-white shadow-lg border border-gray-200 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <a
            href={wazeUrl}
            target="_blank"
            rel="noopener noreferrer"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-4 py-3 text-sm font-medium text-gray-800 hover:bg-blue-50 active:bg-blue-100 min-h-[44px]"
          >
            <span className="text-lg">🗺️</span>
            Waze
          </a>
          <a
            href={isIOS ? googleIosUrl : googleUrl}
            target="_blank"
            rel="noopener noreferrer"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-4 py-3 text-sm font-medium text-gray-800 hover:bg-blue-50 active:bg-blue-100 border-t border-gray-100 min-h-[44px]"
          >
            <span className="text-lg">📍</span>
            Google Maps
          </a>
          {isIOS && (
            <a
              href={appleUrl}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-4 py-3 text-sm font-medium text-gray-800 hover:bg-blue-50 active:bg-blue-100 border-t border-gray-100 min-h-[44px]"
            >
              <span className="text-lg">🍎</span>
              Apple Maps
            </a>
          )}
        </span>
      )}
    </span>
  )
}
