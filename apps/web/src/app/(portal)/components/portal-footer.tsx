'use client'

import { useEffect, useState } from 'react'

export function PortalFooter() {
  const [companyName, setCompanyName] = useState('')
  const currentYear = new Date().getFullYear()

  useEffect(() => {
    const stored = localStorage.getItem('portal_company')
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        setCompanyName(parsed.name || parsed.company_name || '')
      } catch {
        setCompanyName(stored)
      }
    }
  }, [])

  return (
    <footer className="print-hidden mt-auto border-t border-gray-200/60 dark:border-zinc-800/60 bg-white/50 dark:bg-zinc-900/50 backdrop-blur-sm">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
          <div className="text-center sm:text-left">
            {companyName && (
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{companyName}</p>
            )}
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Portal do Cliente &mdash; Powered by{' '}
              <span className="font-semibold text-blue-700 dark:text-blue-400">PontualERP</span>
            </p>
          </div>

          <div className="flex items-center gap-4 text-xs text-gray-400 dark:text-gray-500">
            <a
              href="https://pontualtech.com.br/politica-de-privacidade.html"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-gray-600 dark:hover:text-gray-300"
            >
              Pol&iacute;tica de Privacidade
            </a>
            <span className="text-gray-300 dark:text-zinc-700">|</span>
            <a
              href="https://wa.me/551126263841"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-green-600 dark:hover:text-green-400"
            >
              Suporte via WhatsApp
            </a>
            <span className="text-gray-300 dark:text-zinc-700">|</span>
            <span>&copy; {currentYear}</span>
          </div>
        </div>
      </div>
    </footer>
  )
}
