import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import '../globals.css'
import { Toaster } from 'sonner'
import { ThemeProvider } from 'next-themes'
import { PortalFooter } from './components/portal-footer'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Portal do Cliente',
  description: 'Acompanhe suas ordens de servico',
  icons: {
    icon: '/favicon.svg',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#1e40af',
}

export default function PortalRootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: `
          @media print {
            .print-hidden { display: none !important; }
            body { background: white !important; }
            .print-break { page-break-before: always; }
          }
        `}} />
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-Z2TDQ081F5" />
        <script dangerouslySetInnerHTML={{ __html: `
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', 'G-Z2TDQ081F5', { send_page_view: true });
        `}} />
      </head>
      <body className={`${inter.className} bg-gray-50 dark:bg-zinc-950 min-h-screen antialiased flex flex-col transition-colors`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <div className="flex-1">
            {children}
          </div>
          <PortalFooter />
          <Toaster position="top-right" richColors />
        </ThemeProvider>
      </body>
    </html>
  )
}
