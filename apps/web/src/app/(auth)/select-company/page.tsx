'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

interface Company {
  id: string
  name: string
  slug: string
  logo: string | null
}

export default function SelectCompanyPage() {
  const router = useRouter()
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/auth/companies')
      .then(res => res.json())
      .then(data => {
        setCompanies(data.data || [])
        // Se só tem uma empresa, selecionar automaticamente
        if (data.data?.length === 1) {
          selectCompany(data.data[0].id)
        }
      })
      .catch(() => toast.error('Erro ao carregar empresas'))
      .finally(() => setLoading(false))
  }, [])

  async function selectCompany(companyId: string) {
    try {
      const res = await fetch('/api/auth/switch-company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      })

      if (!res.ok) throw new Error('Erro ao selecionar empresa')

      router.push('/')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-gray-500">Carregando empresas...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-md">
        <h1 className="text-2xl font-bold text-center mb-2">Selecionar Empresa</h1>
        <p className="text-gray-500 text-center mb-6">Escolha a empresa para acessar</p>

        {companies.length === 0 ? (
          <p className="text-center text-gray-400">Nenhuma empresa encontrada</p>
        ) : (
          <div className="space-y-3">
            {companies.map(company => (
              <button
                key={company.id}
                onClick={() => selectCompany(company.id)}
                className="w-full p-4 border rounded-lg hover:bg-gray-50 text-left flex items-center gap-3 transition-colors"
              >
                <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center text-primary font-bold">
                  {company.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="font-medium">{company.name}</div>
                  <div className="text-sm text-gray-500">{company.slug}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
