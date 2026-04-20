'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'

export default function PortalLoginPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const slug = params.slug as string

  // Pre-fill document from URL param (from email links)
  const docFromUrl = searchParams.get('doc') || ''
  const redirectAfterLogin = searchParams.get('redirect') || ''

  const [company, setCompany] = useState<{ name: string; logo?: string } | null>(null)
  const [document, setDocument] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingCompany, setLoadingCompany] = useState(true)

  // Auth method selection — 'wa' (WhatsApp) is primary, 'cpf' is fallback
  const [authMethod, setAuthMethod] = useState<'wa' | 'cpf'>('wa')

  // WhatsApp login
  const [phone, setPhone] = useState('')
  const [waLoading, setWaLoading] = useState(false)

  // OTP 2FA (reused for email OTP from CPF login AND WhatsApp OTP)
  const [showOtp, setShowOtp] = useState(false)
  const [otpChannel, setOtpChannel] = useState<'email' | 'whatsapp'>('email')
  const [otpCode, setOtpCode] = useState('')
  const [otpLoading, setOtpLoading] = useState(false)
  const [otpData, setOtpData] = useState<{ customer_id: string; company_id: string; email_hint?: string | null; phone_hint?: string | null } | null>(null)
  const [otpTimer, setOtpTimer] = useState(0)

  // Recuperar senha
  const [showRecovery, setShowRecovery] = useState(false)
  const [recoveryDoc, setRecoveryDoc] = useState('')
  const [recoveryLoading, setRecoveryLoading] = useState(false)
  const [recoveryResult, setRecoveryResult] = useState<{
    success: boolean
    email_hint: string | null
    message: string
  } | null>(null)

  // OTP countdown timer
  useEffect(() => {
    if (otpTimer <= 0) return
    const interval = setInterval(() => setOtpTimer(t => t - 1), 1000)
    return () => clearInterval(interval)
  }, [otpTimer])

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault()
    if (!otpCode || otpCode.length !== 6 || !otpData) {
      toast.error('Digite o codigo de 6 digitos')
      return
    }

    setOtpLoading(true)
    try {
      const res = await fetch('/api/portal/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: otpData.customer_id,
          company_id: otpData.company_id,
          otp_code: otpCode,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || 'Codigo invalido')
        return
      }

      localStorage.setItem('portal_customer', JSON.stringify(data.data.customer))
      localStorage.setItem('portal_company', JSON.stringify(data.data.company))

      toast.success('Login realizado com sucesso!')
      try { const { portalEvents } = await import('@/lib/analytics'); portalEvents.login('otp_2fa') } catch {}
      router.push(redirectAfterLogin || `/portal/${slug}`)
    } catch {
      toast.error('Erro de conexao')
    } finally {
      setOtpLoading(false)
    }
  }

  async function handleResendOtp() {
    if (otpTimer > 240) { // can resend after 60s
      toast.error('Aguarde antes de solicitar um novo codigo')
      return
    }
    setLoading(true)
    try {
      const isWa = otpChannel === 'whatsapp'
      const endpoint = isWa ? '/api/portal/auth/wa-otp/send' : '/api/portal/auth'
      const body = isWa
        ? { phone: phone.replace(/\D/g, ''), company_slug: slug }
        : { document: document.replace(/\D/g, ''), password, company_slug: slug }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (res.ok && data.data?.requires_otp) {
        setOtpTimer(isWa ? 600 : 300)
        setOtpCode('')
        toast.success('Novo codigo enviado!')
      } else {
        toast.error(data.error || 'Erro ao reenviar')
      }
    } catch {
      toast.error('Erro de conexao')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetch(`/api/portal/company?slug=${slug}`)
      .then(r => r.json())
      .then(res => {
        if (res.data) setCompany(res.data)
        else setCompany({ name: slug })
      })
      .catch(() => setCompany({ name: slug }))
      .finally(() => setLoadingCompany(false))
  }, [slug])

  // Pre-fill document from email link (?doc=32772178000147)
  useEffect(() => {
    if (docFromUrl) {
      setDocument(formatDocument(docFromUrl))
    }
  }, [docFromUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  function formatDocument(value: string) {
    const digits = value.replace(/\D/g, '')
    if (digits.length <= 11) {
      // CPF: 000.000.000-00
      return digits
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
    }
    // CNPJ: 00.000.000/0000-00
    return digits
      .replace(/(\d{2})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1/$2')
      .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
  }

  function handleGoogleLogin() {
    const redirect = redirectAfterLogin || ''
    const params = new URLSearchParams({ slug })
    if (redirect) params.set('redirect', redirect)
    window.location.href = `/api/portal/auth/google?${params.toString()}`
  }

  function formatPhone(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 11)
    if (digits.length <= 2) return digits
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  }

  async function handleWhatsAppLogin(e: React.FormEvent) {
    e.preventDefault()
    const phoneDigits = phone.replace(/\D/g, '')
    if (phoneDigits.length < 10) {
      toast.error('Informe um numero de WhatsApp valido com DDD')
      return
    }

    setWaLoading(true)
    try {
      const res = await fetch('/api/portal/auth/wa-otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneDigits, company_slug: slug }),
      })
      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || 'Nao foi possivel enviar o codigo')
        return
      }

      setOtpData({
        customer_id: data.data.customer_id,
        company_id: data.data.company_id,
        phone_hint: data.data.phone_hint,
      })
      setOtpChannel('whatsapp')
      setShowOtp(true)
      setOtpTimer(600) // 10 min
      toast.success('Codigo enviado para seu WhatsApp!')
    } catch {
      toast.error('Erro de conexao')
    } finally {
      setWaLoading(false)
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!document || !password) {
      toast.error('Preencha todos os campos')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/portal/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document: document.replace(/\D/g, ''),
          password,
          company_slug: slug,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        // If access not registered, redirect to register page
        if (res.status === 403 && data.error?.includes('primeiro acesso')) {
          toast.error('Voce ainda nao tem acesso ao portal. Vamos ativar agora!')
          router.push(`/portal/${slug}/registrar`)
          return
        }
        // If customer not found, suggest cadastro
        if (res.status === 404 && data.error?.includes('nao encontrado')) {
          toast.error('CPF/CNPJ nao encontrado. Faca seu cadastro!')
          router.push(`/portal/${slug}/cadastro`)
          return
        }
        toast.error(data.error || 'Erro ao fazer login')
        return
      }

      // 2FA: server requires OTP verification
      if (data.data?.requires_otp) {
        setOtpData({
          customer_id: data.data.customer_id,
          company_id: data.data.company_id,
          email_hint: data.data.email_hint,
        })
        setOtpChannel('email')
        setShowOtp(true)
        setOtpTimer(300) // 5 minutes in seconds
        toast.success('Codigo enviado para seu email!')
        return
      }

      // Direct login (fallback if OTP disabled)
      localStorage.setItem('portal_customer', JSON.stringify(data.data.customer))
      localStorage.setItem('portal_company', JSON.stringify(data.data.company))

      toast.success('Login realizado com sucesso!')
      try { const { portalEvents } = await import('@/lib/analytics'); portalEvents.login('cpf_cnpj') } catch {}
      router.push(redirectAfterLogin || `/portal/${slug}`)
    } catch {
      toast.error('Erro de conexao')
    } finally {
      setLoading(false)
    }
  }

  async function handleRecovery(e: React.FormEvent) {
    e.preventDefault()
    if (!recoveryDoc) {
      toast.error('Informe seu CPF ou CNPJ')
      return
    }

    setRecoveryLoading(true)
    try {
      const res = await fetch('/api/portal/recuperar-senha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document: recoveryDoc.replace(/\D/g, ''),
          company_slug: slug,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || 'Erro ao resetar senha')
        return
      }

      setRecoveryResult(data)
      toast.success('Senha resetada com sucesso!')
    } catch {
      toast.error('Erro de conexao')
    } finally {
      setRecoveryLoading(false)
    }
  }

  if (loadingCompany) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-zinc-950 dark:to-zinc-900 px-4 py-8">
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl dark:shadow-zinc-900/50 p-6 sm:p-8 dark:border dark:border-zinc-800">
          {/* Header — compact on mobile */}
          <div className="text-center mb-6 sm:mb-8">
            {company?.logo ? (
              <img src={company.logo} alt={company.name} className="h-12 sm:h-16 mx-auto mb-3" />
            ) : (
              <div className="w-12 h-12 sm:w-16 sm:h-16 bg-blue-600 dark:bg-blue-500 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 sm:w-8 sm:h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
            )}
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">{company?.name}</h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">Portal do Cliente</p>
          </div>

          {showOtp ? (
            <>
              {/* OTP Verification */}
              <div className="text-center mb-6">
                <div className="w-14 h-14 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-7 h-7 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  {otpChannel === 'whatsapp' ? 'Confirmacao por WhatsApp' : 'Verificacao em 2 etapas'}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {otpChannel === 'whatsapp'
                    ? `Codigo enviado via WhatsApp para ${otpData?.phone_hint || 'seu numero'}`
                    : `Codigo enviado para ${otpData?.email_hint || 'seu email'}`}
                </p>
              </div>

              <form onSubmit={handleVerifyOtp} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Codigo de verificacao
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={otpCode}
                    onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    className="w-full px-4 py-4 border border-gray-300 dark:border-zinc-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-gray-900 dark:text-gray-100 bg-white dark:bg-zinc-800 placeholder-gray-400 dark:placeholder-gray-600 text-center text-2xl font-mono tracking-[0.5em]"
                    autoFocus
                    autoComplete="one-time-code"
                  />
                </div>

                {/* Timer */}
                <div className="text-center">
                  {otpTimer > 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Codigo expira em{' '}
                      <span className={`font-mono font-bold ${otpTimer <= 60 ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}`}>
                        {Math.floor(otpTimer / 60)}:{String(otpTimer % 60).padStart(2, '0')}
                      </span>
                    </p>
                  ) : (
                    <p className="text-sm text-red-600 dark:text-red-400 font-medium">Codigo expirado</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={otpLoading || otpCode.length !== 6}
                  className="w-full py-3 px-4 bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 dark:hover:bg-blue-600 disabled:bg-blue-400 dark:disabled:bg-blue-800 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  {otpLoading ? (
                    <>
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                      Verificando...
                    </>
                  ) : (
                    'Verificar e Entrar'
                  )}
                </button>

                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={handleResendOtp}
                    disabled={otpTimer > 240}
                    className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium disabled:text-gray-400 dark:disabled:text-gray-600 disabled:cursor-not-allowed"
                  >
                    Reenviar codigo
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowOtp(false); setOtpCode(''); setOtpData(null) }}
                    className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                  >
                    Voltar ao login
                  </button>
                </div>
              </form>
            </>
          ) : !showRecovery ? (
            <>
              {/* Google Login — primary option */}
              <button
                type="button"
                onClick={handleGoogleLogin}
                className="w-full py-3 px-4 border-2 border-gray-200 dark:border-zinc-700 hover:border-gray-300 dark:hover:border-zinc-600 hover:bg-gray-50 dark:hover:bg-zinc-800 rounded-xl transition-colors flex items-center justify-center gap-3 text-gray-700 dark:text-gray-200 font-medium mb-4"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Continuar com Google
              </button>

              {/* Divider */}
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200 dark:border-zinc-700" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="px-2 bg-white dark:bg-zinc-900 text-gray-500 dark:text-gray-400 uppercase tracking-wider">ou</span>
                </div>
              </div>

              {/* Method tabs */}
              <div className="flex gap-1 p-1 bg-gray-100 dark:bg-zinc-800 rounded-xl mb-4">
                <button
                  type="button"
                  onClick={() => setAuthMethod('wa')}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                    authMethod === 'wa'
                      ? 'bg-white dark:bg-zinc-700 text-blue-600 dark:text-blue-400 shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}
                >
                  📱 WhatsApp
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMethod('cpf')}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                    authMethod === 'cpf'
                      ? 'bg-white dark:bg-zinc-700 text-blue-600 dark:text-blue-400 shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}
                >
                  CPF / CNPJ
                </button>
              </div>

              {authMethod === 'wa' ? (
                /* WhatsApp Login Form */
                <form onSubmit={handleWhatsAppLogin} className="space-y-4">
                  <div>
                    <label htmlFor="phone" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      Seu numero de WhatsApp
                    </label>
                    <input
                      id="phone"
                      type="tel"
                      inputMode="numeric"
                      value={phone}
                      onChange={e => setPhone(formatPhone(e.target.value))}
                      placeholder="(11) 99999-9999"
                      maxLength={15}
                      className="w-full px-4 py-4 text-lg border border-gray-300 dark:border-zinc-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-gray-900 dark:text-gray-100 bg-white dark:bg-zinc-800 placeholder-gray-400 dark:placeholder-gray-600"
                      autoFocus
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                      Enviaremos um codigo pelo WhatsApp para voce entrar
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={waLoading}
                    className="w-full py-4 px-4 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-bold text-lg rounded-xl transition-colors flex items-center justify-center gap-2 active:scale-[0.98] min-h-[56px]"
                  >
                    {waLoading ? (
                      <>
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                        Enviando...
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                        </svg>
                        Receber codigo no WhatsApp
                      </>
                    )}
                  </button>
                </form>
              ) : (
                /* CPF/CNPJ + Senha Login Form (existing) */
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label htmlFor="document" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    CPF / CNPJ
                  </label>
                  <input
                    id="document"
                    type="text"
                    inputMode="numeric"
                    value={document}
                    onChange={e => setDocument(formatDocument(e.target.value))}
                    placeholder="Digite seu CPF ou CNPJ"
                    maxLength={18}
                    className="w-full px-4 py-4 text-lg border border-gray-300 dark:border-zinc-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-gray-900 dark:text-gray-100 bg-white dark:bg-zinc-800 placeholder-gray-400 dark:placeholder-gray-600"
                    autoFocus={!docFromUrl}
                    readOnly={!!docFromUrl && document.length > 0}
                  />
                  {docFromUrl && document && (
                    <button
                      type="button"
                      onClick={() => { setDocument(''); }}
                      className="text-xs text-blue-600 dark:text-blue-400 mt-1 hover:underline"
                    >
                      Usar outro documento
                    </button>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Senha
                    </label>
                    <button
                      type="button"
                      onClick={() => { setShowRecovery(true); setRecoveryResult(null); setRecoveryDoc('') }}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium"
                    >
                      Esqueci minha senha
                    </button>
                  </div>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Digite sua senha"
                    autoFocus={!!docFromUrl}
                    className="w-full px-4 py-4 text-lg border border-gray-300 dark:border-zinc-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-gray-900 dark:text-gray-100 bg-white dark:bg-zinc-800 placeholder-gray-400 dark:placeholder-gray-600"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-4 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-bold text-lg rounded-xl transition-colors flex items-center justify-center gap-2 active:scale-[0.98] min-h-[56px]"
                >
                  {loading ? (
                    <>
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                      Entrando...
                    </>
                  ) : (
                    'Entrar'
                  )}
                </button>
              </form>
              )}

              {/* Register links */}
              <div className="mt-6 space-y-3">
                <Link
                  href={`/portal/${slug}/cadastro`}
                  className="block w-full text-center py-3 rounded-xl border-2 border-blue-600 dark:border-blue-400 text-blue-600 dark:text-blue-400 font-semibold text-sm hover:bg-blue-50 dark:hover:bg-blue-950 transition-colors"
                >
                  Cadastre-se
                </Link>
                <p className="text-gray-400 dark:text-gray-500 text-xs text-center">
                  Ja tem cadastro mas nao tem senha?{' '}
                  <Link href={`/portal/${slug}/registrar`} className="text-blue-500 dark:text-blue-400 hover:underline">
                    Ative seu acesso aqui
                  </Link>
                </p>
              </div>
            </>
          ) : (
            <>
              {/* Password Recovery */}
              {!recoveryResult ? (
                <form onSubmit={handleRecovery} className="space-y-5">
                  <div>
                    <label htmlFor="recovery-doc" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      CPF / CNPJ
                    </label>
                    <input
                      id="recovery-doc"
                      type="text"
                      value={recoveryDoc}
                      onChange={e => setRecoveryDoc(formatDocument(e.target.value))}
                      placeholder="000.000.000-00"
                      maxLength={18}
                      className="w-full px-4 py-3 border border-gray-300 dark:border-zinc-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-gray-900 dark:text-gray-100 bg-white dark:bg-zinc-800 placeholder-gray-400 dark:placeholder-gray-600"
                      autoFocus
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={recoveryLoading}
                    className="w-full py-3 px-4 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    {recoveryLoading ? (
                      <>
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                        Resetando...
                      </>
                    ) : (
                      'Resetar Senha'
                    )}
                  </button>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-900 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                      <svg className="w-6 h-6 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div>
                        <p className="font-medium text-green-900 dark:text-green-300">Senha resetada com sucesso!</p>
                        <p className="text-sm text-green-700 dark:text-green-400 mt-1">
                          Use os 5 primeiros digitos do seu CPF/CNPJ como senha.
                        </p>
                      </div>
                    </div>
                  </div>

                  {recoveryResult.email_hint && (
                    <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-900 rounded-xl p-4">
                      <p className="text-sm text-blue-800 dark:text-blue-300">
                        Um email foi enviado para <strong>{recoveryResult.email_hint}</strong> com as instrucoes.
                      </p>
                    </div>
                  )}

                  <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-900 rounded-xl p-4">
                    <p className="text-sm text-amber-800 dark:text-amber-300">
                      <strong>Exemplo:</strong> CPF 123.456.789-00 → senha: <strong>12345</strong>
                    </p>
                  </div>
                </div>
              )}

              {/* Back to login */}
              <div className="mt-6 text-center">
                <button
                  type="button"
                  onClick={() => { setShowRecovery(false); setRecoveryResult(null) }}
                  className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 text-sm font-medium"
                >
                  Voltar ao login
                </button>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-gray-400 dark:text-gray-500 text-xs mt-6">
          Powered by PontualERP
        </p>
      </div>
    </div>
  )
}
