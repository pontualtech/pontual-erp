import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { Sidebar } from './components/sidebar'
import { Header } from './components/header'
import { ThemeProvider } from './components/theme-provider'
import { AnnouncementModal } from './components/announcement-modal'
import { RouteGuard } from './components/route-guard'

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
      </div>
    </ThemeProvider>
  )
}
