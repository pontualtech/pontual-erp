'use client'

import { useEffect, useState } from 'react'

function normalizeWhatsApp(raw: string | undefined | null): string {
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  // Ensure 55 country code for wa.me links
  return digits.startsWith('55') ? digits : `55${digits}`
}

// UX-4 #4: trust signals enriquecidos — CNPJ + endereco + anos no mercado
// + selo SSL. Cliente PJ (Sr. Marcos) precisa ver legitimidade antes de pagar.
type CompanyTrust = {
  name?: string
  company_name?: string
  whatsapp?: string
  support_whatsapp?: string
  phone?: string
  cnpj?: string
  address?: string
  address_full?: string
  founded_year?: number
}

export function PortalFooter() {
  const [company, setCompany] = useState<CompanyTrust | null>(null)
  // currentYear must be set in useEffect — when a page is served from the Next
  // build cache around year-turnover, `new Date()` at render time produces a
  // different value than at build time and React throws hydration error #418.
  const [currentYear, setCurrentYear] = useState<number | null>(null)

  useEffect(() => {
    setCurrentYear(new Date().getFullYear())
    const stored = localStorage.getItem('portal_company')
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        setCompany(parsed)
      } catch {
        setCompany({ name: stored })
      }
    }
  }, [])

  const companyName = company?.name || company?.company_name || ''
  const supportWhatsApp = normalizeWhatsApp(company?.whatsapp || company?.support_whatsapp || company?.phone)
  const cnpj = company?.cnpj
  const address = company?.address_full || company?.address
  const yearsInBusiness = company?.founded_year && currentYear ? currentYear - company.founded_year : null

  return (
    <footer className="print-hidden mt-auto border-t border-gray-200/60 dark:border-zinc-800/60 bg-white/50 dark:bg-zinc-900/50 backdrop-blur-sm">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 space-y-3">
        {/* Linha 1: nome + dados fiscais (trust signals) */}
        <div className="flex flex-col items-center gap-2 text-center sm:flex-row sm:justify-between sm:text-left">
          <div>
            {companyName && (
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{companyName}</p>
            )}
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400 sm:justify-start">
              {cnpj && <span>CNPJ {cnpj}</span>}
              {address && <span>· {address}</span>}
              {yearsInBusiness !== null && yearsInBusiness > 0 && (
                <span>· {yearsInBusiness} ano{yearsInBusiness > 1 ? 's' : ''} no mercado</span>
              )}
            </div>
          </div>

          {/* Selo SSL + ano */}
          <div className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
            <span className="inline-flex items-center gap-1 rounded-full bg-green-50 dark:bg-green-950 px-2 py-0.5 font-medium text-green-700 dark:text-green-400 border border-green-200 dark:border-green-900">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Conexão segura
            </span>
            <span suppressHydrationWarning>&copy; {currentYear ?? ''}</span>
          </div>
        </div>

        {/* Linha 2: links */}
        <div className="flex items-center justify-center gap-3 text-[11px] text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-zinc-800 pt-3">
          <a
            href="https://pontualtech.com.br/politica-de-privacidade.html"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-gray-600 dark:hover:text-gray-300"
          >
            Pol&iacute;tica de Privacidade
          </a>
          {supportWhatsApp && (
            <>
              <span className="text-gray-300 dark:text-zinc-700">|</span>
              <a
                href={`https://wa.me/${supportWhatsApp}`}
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-green-600 dark:hover:text-green-400"
              >
                Suporte WhatsApp
              </a>
            </>
          )}
          <span className="text-gray-300 dark:text-zinc-700">|</span>
          <span className="opacity-60">Powered by PontualERP</span>
        </div>
      </div>
    </footer>
  )
}
