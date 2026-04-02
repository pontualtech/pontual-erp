'use client'

import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/use-auth'
import { ShieldAlert } from 'lucide-react'
import Link from 'next/link'

/**
 * Maps route prefixes to required permissions.
 * If a route is listed here, the user must have the specified permission OR be admin.
 * Routes marked adminOnly require the admin role.
 */
const routePermissions: { prefix: string; module: string; action: string; adminOnly?: boolean }[] = [
  { prefix: '/fiscal', module: 'fiscal', action: 'view' },
  { prefix: '/financeiro', module: 'financeiro', action: 'view' },
  { prefix: '/config', module: 'config', action: 'view', adminOnly: true },
  { prefix: '/relatorios-bi', module: 'financeiro', action: 'view' },
  { prefix: '/contratos', module: 'config', action: 'view', adminOnly: true },
  { prefix: '/chat', module: 'os', action: 'edit' },
  { prefix: '/integracoes/chatwoot', module: 'os', action: 'edit' },
]

export function RouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { user, isAdmin, hasPermission } = useAuth()

  // While loading auth, render children (server already validated auth)
  if (!user) return <>{children}</>

  // Check if current route requires specific permission
  const rule = routePermissions.find(r => pathname === r.prefix || pathname.startsWith(r.prefix + '/'))

  if (rule) {
    if (rule.adminOnly && !isAdmin) {
      return <AccessDenied />
    }
    if (!isAdmin && !hasPermission(rule.module, rule.action)) {
      return <AccessDenied />
    }
  }

  return <>{children}</>
}

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100 mb-4">
        <ShieldAlert className="h-8 w-8 text-red-500" />
      </div>
      <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
        Acesso negado
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-md">
        Voce nao tem permissao para acessar esta pagina. Entre em contato com o administrador se acredita que isso e um erro.
      </p>
      <Link
        href="/"
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        Voltar ao Dashboard
      </Link>
    </div>
  )
}
