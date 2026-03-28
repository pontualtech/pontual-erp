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
      <body className={`${inter.className} bg-gray-50 min-h-screen`}>
        {children}
        <Toaster position="top-right" richColors />
      </body>
    </html>
  )
}
