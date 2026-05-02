import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { Sidebar } from './components/sidebar'
import { Header } from './components/header'
import { ThemeProvider } from './components/theme-provider'
import { AnnouncementModal } from './components/announcement-modal'
import { RouteGuard } from './components/route-guard'
import { KeyboardShortcuts } from './components/keyboard-shortcuts'
import { CallToast } from '@/components/voip/CallToast'
import { SonaxWebphone } from '@/components/voip/SonaxWebphone'
import { SonaxCallControls } from '@/components/voip/SonaxCallControls'
import { PontualWebphone } from '@/components/voip/PontualWebphone'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getServerUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <ThemeProvider>
      <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-900">
        <Sidebar user={user} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Header user={user} />
          <main className="flex-1 overflow-y-auto p-6 dark:text-gray-100">
            <RouteGuard>
              {children}
            </RouteGuard>
          </main>
        </div>
        <AnnouncementModal />
        <KeyboardShortcuts />
        <CallToast />
        {/* SonaxWebphone — FEATURE FLAG.
            Default true (compat retroativo). Setar NEXT_PUBLIC_SONAX_WEBPHONE_ENABLED=false
            no Coolify pra esconder e usar SOMENTE PontualPABX.
            Motivo da flag: microfone do browser é exclusivo. Quando ambos webphones
            disputam getUserMedia, o segundo recebe stream tainted/vazia, RTP não
            sai, Asterisk derruba a chamada por timeout. */}
        {process.env.NEXT_PUBLIC_SONAX_WEBPHONE_ENABLED !== 'false' && <SonaxWebphone />}
        {process.env.NEXT_PUBLIC_SONAX_WEBPHONE_ENABLED !== 'false' && <SonaxCallControls />}
        {/* PontualWebphone (SIP.js -> Asterisk proprio) — FEATURE FLAG. */}
        {process.env.NEXT_PUBLIC_PONTUAL_WEBPHONE_ENABLED === 'true' && <PontualWebphone />}
      </div>
    </ThemeProvider>
  )
}
