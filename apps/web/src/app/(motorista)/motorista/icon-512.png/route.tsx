import { ImageResponse } from 'next/og'

export const runtime = 'nodejs'
export const dynamic = 'force-static'

/**
 * PNG 512x512 — splash screen do Android + ícone maskable.
 * Versão "maskable" deixa ~10% de padding pras safe-zones em Android
 * adaptive icons (formas de ícone circulares, squircle, etc).
 */
export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#1e40af',   // fundo solido pra maskable
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{
          width: 380,
          height: 380,
          background: 'linear-gradient(135deg, #2563eb 0%, #60a5fa 100%)',
          borderRadius: 80,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          fontSize: 240,
          fontWeight: 900,
          fontFamily: 'system-ui, sans-serif',
          letterSpacing: -10,
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}>
          PR
        </div>
      </div>
    ),
    { width: 512, height: 512 },
  )
}
