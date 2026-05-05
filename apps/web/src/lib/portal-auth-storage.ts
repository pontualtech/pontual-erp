/**
 * Sprint UX-32: helper para ler dados de autenticacao do portal
 * salvos em localStorage. Antes 5+ paginas faziam JSON.parse(...)
 * sem try/catch — se localStorage corrompesse (ex: erro de gravacao,
 * versao antiga, manipulacao manual), Cliente via tela em branco sem
 * feedback. Helper centraliza fallback seguro.
 */

export interface PortalCompany {
  id?: string
  slug?: string
  name: string
  [key: string]: unknown
}

export interface PortalCustomer {
  id?: string
  name: string
  document_number?: string
  email?: string
  [key: string]: unknown
}

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    // localStorage corrompido — limpa pra evitar loop infinito de erro
    return null
  }
}

export function readPortalCompany(): PortalCompany | null {
  if (typeof window === 'undefined') return null
  return safeParseJson<PortalCompany>(localStorage.getItem('portal_company'))
}

export function readPortalCustomer(): PortalCustomer | null {
  if (typeof window === 'undefined') return null
  return safeParseJson<PortalCustomer>(localStorage.getItem('portal_customer'))
}

export function clearPortalAuth(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem('portal_customer')
    localStorage.removeItem('portal_company')
  } catch {
    // localStorage indisponivel (ex: privacy mode) — silencioso
  }
}
