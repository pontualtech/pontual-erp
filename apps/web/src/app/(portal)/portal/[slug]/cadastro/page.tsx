'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'

function toTitleCase(str: string): string {
  return str.toLowerCase().replace(/(?:^|\s|[-/])\S/g, c => c.toUpperCase())
}

const STEPS = ['Identificacao', 'Dados Pessoais', 'Endereco', 'Senha']

const UF_OPTIONS = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA',
  'PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO',
]

function formatDocument(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 11) {
    return digits
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
  }
  return digits
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 10) {
    return digits
      .replace(/(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{4})(\d{1,4})$/, '$1-$2')
  }
  return digits
    .replace(/(\d{2})(\d)/, '($1) $2')
    .replace(/(\d{5})(\d{1,4})$/, '$1-$2')
}

function formatCep(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 8)
  return digits.replace(/(\d{5})(\d{1,3})$/, '$1-$2')
}

export default function CadastroPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params.slug as string

  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [company, setCompany] = useState<{ name: string; logo?: string } | null>(null)
  const [loadingCompany, setLoadingCompany] = useState(true)
  const [fetchingCnpj, setFetchingCnpj] = useState(false)
  const [fetchingCep, setFetchingCep] = useState(false)
  const [checkingDoc, setCheckingDoc] = useState(false)
  const [existingCustomer, setExistingCustomer] = useState<{
    exists: boolean; has_access: boolean; customer_name: string; email_hint: string | null
  } | null>(null)

  // Step 1
  const [document, setDocument] = useState('')
  const [personType, setPersonType] = useState<'FISICA' | 'JURIDICA'>('FISICA')

  // Step 2
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [telefone, setTelefone] = useState('')

  // Step 3
  const [cep, setCep] = useState('')
  const [logradouro, setLogradouro] = useState('')
  const [numero, setNumero] = useState('')
  const [complemento, setComplemento] = useState('')
  const [bairro, setBairro] = useState('')
  const [cidade, setCidade] = useState('')
  const [uf, setUf] = useState('')

  // Step 4
  const [senha, setSenha] = useState('')
  const [confirmarSenha, setConfirmarSenha] = useState('')
  const [aceitaTermos, setAceitaTermos] = useState(false)

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

  const digits = document.replace(/\D/g, '')

  useEffect(() => {
    if (digits.length <= 11) setPersonType('FISICA')
    else setPersonType('JURIDICA')
  }, [digits])

  // Auto-fetch CNPJ data when 14 digits are typed
  const [cnpjFetched, setCnpjFetched] = useState('')

  useEffect(() => {
    if (digits.length !== 14 || digits === cnpjFetched) return
    let cancelled = false
    setFetchingCnpj(true)

    fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`)
      .then(r => { if (!r.ok) throw new Error('CNPJ nao encontrado'); return r.json() })
      .then(data => {
        if (cancelled) return
        if (data.razao_social) setNome(toTitleCase(data.razao_social))
        if (data.cep) {
          const cepClean = data.cep.replace(/\D/g, '')
          setCep(formatCep(cepClean))
          // Fetch CEP data too
          fetch(`https://viacep.com.br/ws/${cepClean}/json/`)
            .then(r => r.json())
            .then(cepData => {
              if (cancelled || cepData.erro) return
              if (cepData.logradouro) setLogradouro(toTitleCase(cepData.logradouro))
              if (cepData.bairro) setBairro(toTitleCase(cepData.bairro))
              if (cepData.localidade) setCidade(toTitleCase(cepData.localidade))
              if (cepData.uf) setUf(cepData.uf.toUpperCase())
            }).catch(() => {})
        }
        if (data.logradouro) setLogradouro(toTitleCase(data.logradouro))
        if (data.numero) setNumero(data.numero)
        if (data.complemento) setComplemento(toTitleCase(data.complemento))
        if (data.bairro) setBairro(toTitleCase(data.bairro))
        if (data.municipio) setCidade(toTitleCase(data.municipio))
        if (data.uf) setUf(data.uf.toUpperCase())
        setCnpjFetched(digits)
        toast.success('Dados do CNPJ preenchidos!')
        setStep(1) // Avança para step 2
      })
      .catch(() => {
        if (!cancelled) toast.error('Nao foi possivel consultar o CNPJ. Preencha manualmente.')
      })
      .finally(() => { if (!cancelled) setFetchingCnpj(false) })

    return () => { cancelled = true }
  }, [digits, cnpjFetched])

  // Keep handleDocumentBlur for the onBlur fallback (manual trigger)
  function handleDocumentBlur() {
    if (digits.length === 14 && digits !== cnpjFetched) {
      setCnpjFetched('') // Force refetch by clearing cached
    }
  }

  async function fetchCepData(cepDigits: string) {
    if (cepDigits.length !== 8) return
    setFetchingCep(true)
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cepDigits}/json/`)
      if (res.ok) {
        const data = await res.json()
        if (!data.erro) {
          if (data.logradouro) setLogradouro(toTitleCase(data.logradouro))
          if (data.bairro) setBairro(toTitleCase(data.bairro))
          if (data.localidade) setCidade(toTitleCase(data.localidade))
          if (data.uf) setUf(data.uf.toUpperCase())
          toast.success('Endereco preenchido pelo CEP')
        }
      }
    } catch {
      // silently fail
    } finally {
      setFetchingCep(false)
    }
  }

  // Auto-fetch CEP when 8 digits typed
  const [cepFetched, setCepFetched] = useState('')
  useEffect(() => {
    const cepDigits = cep.replace(/\D/g, '')
    if (cepDigits.length === 8 && cepDigits !== cepFetched) {
      setCepFetched(cepDigits)
      fetchCepData(cepDigits)
    }
  }, [cep])

  function handleCepBlur() {
    const cepDigits = cep.replace(/\D/g, '')
    if (cepDigits.length === 8) { setCepFetched(''); fetchCepData(cepDigits) }
  }

  function validateStep(): boolean {
    if (step === 0) {
      if (digits.length !== 11 && digits.length !== 14) {
        toast.error('Informe um CPF (11 digitos) ou CNPJ (14 digitos) valido')
        return false
      }
      return true
    }
    if (step === 1) {
      if (!nome.trim()) { toast.error('Informe o nome completo'); return false }
      if (!email.trim() || !email.includes('@')) { toast.error('Informe um email valido'); return false }
      if (telefone.replace(/\D/g, '').length < 10) { toast.error('Informe um telefone valido'); return false }
      return true
    }
    if (step === 2) {
      if (cep.replace(/\D/g, '').length !== 8) { toast.error('Informe um CEP valido'); return false }
      if (!numero.trim()) { toast.error('Informe o numero do endereco'); return false }
      return true
    }
    if (step === 3) {
      if (senha.length < 6) { toast.error('A senha deve ter pelo menos 6 caracteres'); return false }
      if (senha !== confirmarSenha) { toast.error('As senhas nao conferem'); return false }
      if (!aceitaTermos) { toast.error('Voce precisa aceitar a Politica de Privacidade'); return false }
      return true
    }
    return true
  }

  async function nextStep() {
    if (!validateStep()) return

    // On step 0: check if customer already exists in ERP
    if (step === 0) {
      setCheckingDoc(true)
      setExistingCustomer(null)
      try {
        const res = await fetch('/api/portal/check-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ document: document.replace(/\D/g, ''), company_slug: slug }),
        })
        const data = await res.json()
        if (res.ok && data.data?.exists) {
          // Customer already exists — show options instead of proceeding
          setExistingCustomer(data.data)
          return
        }
      } catch {}
      finally { setCheckingDoc(false) }
    }

    setStep(s => Math.min(s + 1, STEPS.length - 1))
  }

  function prevStep() {
    setStep(s => Math.max(s - 1, 0))
  }

  async function handleSubmit() {
    if (!validateStep()) return
    setLoading(true)
    try {
      const res = await fetch('/api/portal/cadastro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_slug: slug,
          document_number: digits,
          person_type: personType,
          legal_name: toTitleCase(nome.trim()),
          email: email.trim().toLowerCase(),
          phone: telefone.replace(/\D/g, ''),
          address_zip: cep.replace(/\D/g, ''),
          address_street: toTitleCase(logradouro.trim()),
          address_number: numero.trim(),
          address_complement: toTitleCase(complemento.trim()),
          address_neighborhood: toTitleCase(bairro.trim()),
          address_city: toTitleCase(cidade.trim()),
          address_state: uf.toUpperCase(),
          password: senha,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || 'Erro ao criar conta')
        return
      }

      toast.success('Conta criada com sucesso!')
      setTimeout(() => router.push(`/portal/${slug}/login`), 2000)
    } catch {
      toast.error('Erro de conexao. Tente novamente.')
    } finally {
      setLoading(false)
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
      <div className="w-full max-w-lg">
        <div className="bg-white dark:bg-zinc-900 dark:shadow-zinc-900/50 dark:border dark:border-zinc-800 rounded-2xl shadow-xl p-6 sm:p-8">
          {/* Header */}
          <div className="text-center mb-6">
            {company?.logo ? (
              <img src={company.logo} alt={company.name} className="h-12 mx-auto mb-3" />
            ) : (
              <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
              </div>
            )}
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{company?.name}</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Cadastro de Novo Cliente</p>
          </div>

          {/* Step Indicator */}
          <div className="flex items-center justify-between mb-8">
            {STEPS.map((label, i) => (
              <div key={label} className="flex items-center flex-1">
                <div className="flex flex-col items-center flex-1">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                      i < step
                        ? 'bg-green-500 text-white'
                        : i === step
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-200 dark:bg-zinc-600 text-gray-500 dark:text-gray-400'
                    }`}
                  >
                    {i < step ? (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      i + 1
                    )}
                  </div>
                  <span className={`text-[10px] mt-1 hidden sm:block ${i === step ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-400 dark:text-gray-500'}`}>
                    {label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`h-0.5 w-full mx-1 ${i < step ? 'bg-green-500' : 'bg-gray-200 dark:bg-zinc-600'}`} />
                )}
              </div>
            ))}
          </div>

          {/* Step 1 - Identificacao */}
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CPF ou CNPJ</label>
                <div className="relative">
                  <input
                    type="text"
                    value={document}
                    onChange={e => setDocument(formatDocument(e.target.value))}
                    onBlur={handleDocumentBlur}
                    placeholder="000.000.000-00 ou 00.000.000/0000-00"
                    maxLength={18}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-zinc-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-gray-900 dark:text-gray-100 dark:bg-zinc-800 placeholder-gray-400 dark:placeholder-gray-600"
                    autoFocus
                  />
                  {fetchingCnpj && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" />
                    </div>
                  )}
                </div>
                {digits.length >= 11 && !existingCustomer && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Tipo detectado: <span className="font-medium">{personType === 'FISICA' ? 'Pessoa Fisica (CPF)' : 'Pessoa Juridica (CNPJ)'}</span>
                  </p>
                )}

                {/* Existing customer alert */}
                {existingCustomer && (
                  <div className="mt-4 rounded-xl border-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 p-5">
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 w-10 h-10 bg-amber-100 dark:bg-amber-900 rounded-full flex items-center justify-center">
                        <svg className="w-5 h-5 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                        </svg>
                      </div>
                      <div className="flex-1">
                        <h3 className="font-bold text-amber-800 dark:text-amber-300 text-base">
                          Ola, {existingCustomer.customer_name}!
                        </h3>
                        <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
                          {existingCustomer.has_access
                            ? 'Voce ja tem acesso ao portal. Faca login ou recupere sua senha.'
                            : 'Encontramos seu cadastro no sistema. Ative seu acesso ao portal.'}
                        </p>
                        {existingCustomer.email_hint && (
                          <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
                            Email cadastrado: {existingCustomer.email_hint}
                          </p>
                        )}
                        <div className="flex flex-col sm:flex-row gap-2 mt-4">
                          {existingCustomer.has_access ? (
                            <>
                              <Link
                                href={`/portal/${slug}/login`}
                                className="flex-1 text-center py-2.5 bg-blue-600 dark:bg-blue-500 text-white font-semibold rounded-xl hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors text-sm"
                              >
                                Fazer Login
                              </Link>
                              <button
                                type="button"
                                onClick={() => router.push(`/portal/${slug}/login`)}
                                className="flex-1 text-center py-2.5 border-2 border-amber-500 dark:border-amber-600 text-amber-700 dark:text-amber-400 font-semibold rounded-xl hover:bg-amber-100 dark:hover:bg-amber-900 transition-colors text-sm"
                              >
                                Esqueci a Senha
                              </button>
                            </>
                          ) : (
                            <Link
                              href={`/portal/${slug}/registrar`}
                              className="flex-1 text-center py-2.5 bg-green-600 dark:bg-green-500 text-white font-semibold rounded-xl hover:bg-green-700 dark:hover:bg-green-600 transition-colors text-sm"
                            >
                              Ativar Meu Acesso
                            </Link>
                          )}
                          <button
                            type="button"
                            onClick={() => { setExistingCustomer(null); setDocument('') }}
                            className="flex-1 text-center py-2.5 text-gray-600 dark:text-gray-400 font-medium rounded-xl hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors text-sm"
                          >
                            Usar outro documento
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 2 - Dados Pessoais */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome Completo / Razao Social</label>
                <input
                  type="text"
                  value={nome}
                  onChange={e => setNome(e.target.value)}
                  placeholder={personType === 'JURIDICA' ? 'Razao Social' : 'Nome completo'}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-zinc-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-gray-900 dark:text-gray-100 dark:bg-zinc-800 placeholder-gray-400 dark:placeholder-gray-600"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="seuemail@exemplo.com"
                  className="w-full px-4 py-3 border border-gray-300 dark:border-zinc-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-gray-900 dark:text-gray-100 dark:bg-zinc-800 placeholder-gray-400 dark:placeholder-gray-600"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Telefone / Celular</label>
                <input
                  type="text"
                  value={telefone}
                  onChange={e => setTelefone(formatPhone(e.target.value))}
                  placeholder="(11) 99999-9999"
                  maxLength={15}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-zinc-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-gray-900 dark:text-gray-100 dark:bg-zinc-800 placeholder-gray-400 dark:placeholder-gray-600"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo de Pessoa</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={personType === 'FISICA'}
                      onChange={() => setPersonType('FISICA')}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Pessoa Fisica</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={personType === 'JURIDICA'}
                      onChange={() => setPersonType('JURIDICA')}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Pessoa Juridica</span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Step 3 - Endereco */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CEP</label>
                <div className="relative">
                  <input
                    type="text"
                    value={cep}
                    onChange={e => setCep(formatCep(e.target.value))}
                    onBlur={handleCepBlur}
                    placeholder="00000-000"
                    maxLength={9}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-zinc-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-gray-900 dark:text-gray-100 dark:bg-zinc-800 placeholder-gray-400 dark:placeholder-gray-600"
                    autoFocus
                  />
                  {fetchingCep && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" />
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Logradouro</label>
                <input
                  type="text"
                  value={logradouro}
                  onChange={e => setLogradouro(e.target.value)}
                  placeholder="Rua, Avenida..."
                  className="w-full px-4 py-3 border border-gray-300 dark:border-zinc-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-gray-900 dark:text-gray-100 dark:bg-zinc-800 placeholder-gray-400 dark:placeholder-gray-600"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Numero</label>
                  <input
                    type="text"
                    value={numero}
                    onChange={e => setNumero(e.target.value)}
                    placeholder="123"
                    className="w-full px-4 py-3 border border-gray-300 dark:border-zinc-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-gray-900 dark:text-gray-100 dark:bg-zinc-800 placeholder-gray-400 dark:placeholder-gray-600"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Complemento</label>
                  <input
                    type="text"
                    value={complemento}
                    onChange={e => setComplemento(e.target.value)}
                    placeholder="Apto, Sala..."
                    className="w-full px-4 py-3 border border-gray-300 dark:border-zinc-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-gray-900 dark:text-gray-100 dark:bg-zinc-800 placeholder-gray-400 dark:placeholder-gray-600"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Bairro</label>
                <input
                  type="text"
                  value={bairro}
                  onChange={e => setBairro(e.target.value)}
                  placeholder="Bairro"
                  className="w-full px-4 py-3 border border-gray-300 dark:border-zinc-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-gray-900 dark:text-gray-100 dark:bg-zinc-800 placeholder-gray-400 dark:placeholder-gray-600"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cidade</label>
                  <input
                    type="text"
                    value={cidade}
                    onChange={e => setCidade(e.target.value)}
                    placeholder="Cidade"
                    className="w-full px-4 py-3 border border-gray-300 dark:border-zinc-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-gray-900 dark:text-gray-100 dark:bg-zinc-800 placeholder-gray-400 dark:placeholder-gray-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">UF</label>
                  <select
                    value={uf}
                    onChange={e => setUf(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-zinc-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-gray-900 dark:text-gray-100 bg-white dark:bg-zinc-800"
                  >
                    <option value="">UF</option>
                    {UF_OPTIONS.map(u => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Step 4 - Senha */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Senha</label>
                <input
                  type="password"
                  value={senha}
                  onChange={e => setSenha(e.target.value)}
                  placeholder="Minimo 6 caracteres"
                  className="w-full px-4 py-3 border border-gray-300 dark:border-zinc-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-gray-900 dark:text-gray-100 dark:bg-zinc-800 placeholder-gray-400 dark:placeholder-gray-600"
                  autoFocus
                />
                {senha.length > 0 && senha.length < 6 && (
                  <p className="text-xs text-red-500 mt-1">A senha deve ter pelo menos 6 caracteres</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Confirmar Senha</label>
                <input
                  type="password"
                  value={confirmarSenha}
                  onChange={e => setConfirmarSenha(e.target.value)}
                  placeholder="Repita a senha"
                  className="w-full px-4 py-3 border border-gray-300 dark:border-zinc-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-gray-900 dark:text-gray-100 dark:bg-zinc-800 placeholder-gray-400 dark:placeholder-gray-600"
                />
                {confirmarSenha.length > 0 && senha !== confirmarSenha && (
                  <p className="text-xs text-red-500 mt-1">As senhas nao conferem</p>
                )}
              </div>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={aceitaTermos}
                  onChange={e => setAceitaTermos(e.target.checked)}
                  className="w-4 h-4 mt-0.5 text-blue-600 rounded"
                />
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  Concordo com a{' '}
                  <a href="https://pontualtech.com.br/politica-de-privacidade.html" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">
                    Politica de Privacidade
                  </a>
                </span>
              </label>
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between mt-8 gap-3">
            {step > 0 ? (
              <button
                type="button"
                onClick={prevStep}
                className="px-5 py-3 border border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-gray-300 font-medium rounded-xl hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors"
              >
                Voltar
              </button>
            ) : (
              <div />
            )}

            {step < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={nextStep}
                disabled={checkingDoc || !!existingCustomer}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-xl transition-colors flex items-center gap-2"
              >
                {checkingDoc ? (
                  <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> Verificando...</>
                ) : (
                  'Proximo'
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading}
                className="px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-semibold rounded-xl transition-colors flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                    Criando...
                  </>
                ) : (
                  'Criar Conta'
                )}
              </button>
            )}
          </div>

          {/* Back to login */}
          <div className="mt-6 text-center">
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              Ja tem conta?{' '}
              <Link
                href={`/portal/${slug}/login`}
                className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium"
              >
                Faca login
              </Link>
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-gray-400 dark:text-gray-500 text-xs mt-6">
          Powered by PontualERP
        </p>
      </div>
    </div>
  )
}
