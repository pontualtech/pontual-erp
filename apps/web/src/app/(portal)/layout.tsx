import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import '../globals.css'
import { Toaster } from 'sonner'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Portal do Cliente',
  description: 'Acompanhe suas ordens de servico',
}

export default function PortalRootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-Z2TDQ081F5" />
        <script dangerouslySetInnerHTML={{ __html: `
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', 'G-Z2TDQ081F5', { send_page_view: true });
        `}} />
      </head>
      <body className={`${inter.className} bg-gray-50 min-h-screen`}>
        {children}
        <Toaster position="top-right" richColors />
      </body>
    </html>
  )
}
