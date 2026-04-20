import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { Toaster } from 'sonner'
import '../globals.css'
import ServiceWorkerRegister from './components/sw-register'

// The motorista route group has its own <html>/<body> so we can tailor the
// viewport (no pinch zoom) and PWA theme color without affecting ERP dashboard.

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'PontualRota — App do Motorista',
  description: 'Gerenciar coletas e entregas em campo',
  manifest: '/motorista/manifest.webmanifest',
  // Icons para diferentes contextos — Chrome Android usa icon.src do manifest,
  // Safari iOS usa apple-touch-icon (nao le manifest), Firefox usa shortcut.
  icons: {
    icon: [
      { url: '/motorista/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/motorista/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/motorista/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    shortcut: '/motorista/icon-192.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'PontualRota',
    startupImage: '/motorista/icon-512.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,        // impede zoom out involuntário em campo
  userScalable: false,
  themeColor: '#1e40af',
  viewportFit: 'cover',   // usar safe-area (notch)
}

export default function MotoristaRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body
        className={`${inter.className} bg-slate-50 min-h-[100dvh] antialiased`}
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          paddingLeft: 'env(safe-area-inset-left)',
          paddingRight: 'env(safe-area-inset-right)',
        }}
      >
        {children}
        <ServiceWorkerRegister />
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  )
}
