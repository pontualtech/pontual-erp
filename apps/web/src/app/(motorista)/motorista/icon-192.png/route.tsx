import { ImageResponse } from 'next/og'

export const runtime = 'nodejs'
export const dynamic = 'force-static'   // gera 1 vez, cacheia

/**
 * PNG 192x192 para o manifest do PWA.
 * Gerado on-the-fly via next/og (Satori) — sem commit de binário.
 * Chrome Android exige PNG ≥192x192 com purpose:'any' para habilitar
 * o install prompt "Adicionar à tela inicial".
 */
export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          fontSize: 110,
          fontWeight: 900,
          fontFamily: 'system-ui, sans-serif',
          letterSpacing: -4,
        }}
      >
        PR
      </div>
    ),
    { width: 192, height: 192 },
  )
}
