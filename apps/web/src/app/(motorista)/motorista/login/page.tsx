'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { toast } from 'sonner'
import { Truck, Loader2 } from 'lucide-react'
import InstallPrompt from '../../components/install-prompt'

/**
 * Login dedicado do app do motorista.
 *
 * Por que separar do /login global do ERP:
 *  1. Vive DENTRO do route group (motorista) → manifest + Service Worker
 *     ativos desde o primeiro acesso → Chrome pode oferecer "Instalar app"
 *     ANTES do motorista estar logado (install prompt depende do manifest).
 *  2. Branding "PontualRota" separa mentalmente o app de campo do ERP
 *     completo — motorista se confunde menos.
 *  3. Após login, vai DIRETO pra /motorista/rota (nao precisa decidir
 *     pra onde ir como /login global faz).
 *
 * Usa o mesmo Supabase client que /login — auth é global, só a UI é isolada.
 */
export default function MotoristaLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!email || !password) return
    setLoading(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        toast.error(error.message.includes('Invalid') ? 'Email ou senha incorretos' : error.message)
        return
      }
      // Sucesso: força refresh pra middleware pegar cookie + router pra /motorista/rota
      router.replace('/motorista/rota')
      router.refresh()
    } catch {
      toast.error('Erro de conexão. Tente novamente.')
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-blue-700 to-blue-900 flex flex-col">
      <InstallPrompt />

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="mx-auto w-20 h-20 bg-white rounded-3xl flex items-center justify-center shadow-xl mb-4">
              <Truck className="w-10 h-10 text-blue-700" />
            </div>
            <h1 className="text-white text-2xl font-bold">PontualRota</h1>
            <p className="text-blue-200 text-sm mt-1">App do Motorista</p>
          </div>

          <form onSubmit={handleLogin} className="bg-white rounded-2xl shadow-2xl p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="email">Email</label>
              <input id="email" type="email" required autoComplete="email"
                value={email} onChange={e => setEmail(e.target.value)}
                placeholder="seu@email.com"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="password">Senha</label>
              <input id="password" type="password" required autoComplete="current-password"
                value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-blue-600 text-white font-bold py-3 rounded-lg flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.99] transition">
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Entrar'}
            </button>
          </form>

          <p className="text-center text-blue-200 text-xs mt-6">
            Precisa de acesso? Fale com o operador.
          </p>
        </div>
      </div>
    </div>
  )
}
