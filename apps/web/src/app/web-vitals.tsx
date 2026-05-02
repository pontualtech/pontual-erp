'use client'

import { useReportWebVitals } from 'next/web-vitals'

/**
 * UX-4 #7: report de Web Vitals (LCP/CLS/FID/INP/TTFB) para detectar
 * regressões de performance silenciosas. Beacon-only — não bloqueia render.
 *
 * Endpoint: /api/internal/metrics/web-vitals
 *   - 204 sempre (não falha render se backend offline)
 *   - sample 100% por enquanto, redutor depois se volume virar problema
 *
 * Por que não usar serviço externo (Vercel Analytics / Google Analytics)?
 *   - Coolify self-hosted, alinhado com feedback_self_hosted.md
 */
export function WebVitalsReporter() {
  useReportWebVitals((metric) => {
    try {
      const body = JSON.stringify({
        name: metric.name,
        value: metric.value,
        rating: metric.rating,
        id: metric.id,
        navigationType: metric.navigationType,
        path: typeof window !== 'undefined' ? window.location.pathname : '',
        ts: Date.now(),
      })
      // sendBeacon não bloqueia mesmo se página fechar
      if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
        navigator.sendBeacon('/api/internal/metrics/web-vitals', body)
      } else {
        void fetch('/api/internal/metrics/web-vitals', {
          method: 'POST',
          body,
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
        }).catch(() => {})
      }
    } catch { /* swallow — telemetry never breaks UX */ }
  })

  return null
}
