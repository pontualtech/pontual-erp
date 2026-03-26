/**
 * Formata centavos para moeda brasileira
 * Ex: 15000 → "R$ 150,00"
 */
export function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100)
}

/**
 * Parse moeda para centavos
 * Ex: "150,00" → 15000
 */
export function parseCurrency(value: string): number {
  const cleaned = value.replace(/[^\d,.-]/g, '').replace(',', '.')
  return Math.round(parseFloat(cleaned) * 100)
}

/**
 * Formata CPF: 12345678901 → 123.456.789-01
 */
export function formatCPF(cpf: string): string {
  const digits = cpf.replace(/\D/g, '')
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
}

/**
 * Formata CNPJ: 12345678000147 → 12.345.678/0001-47
 */
export function formatCNPJ(cnpj: string): string {
  const digits = cnpj.replace(/\D/g, '')
  return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
}

/**
 * Formata CPF ou CNPJ baseado no tamanho
 */
export function formatDocument(doc: string): string {
  const digits = doc.replace(/\D/g, '')
  return digits.length <= 11 ? formatCPF(digits) : formatCNPJ(digits)
}

/**
 * Formata CEP: 04128001 → 04128-001
 */
export function formatCEP(cep: string): string {
  const digits = cep.replace(/\D/g, '')
  return digits.replace(/(\d{5})(\d{3})/, '$1-$2')
}

/**
 * Formata telefone: 11912345678 → (11) 91234-5678
 */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 11) {
    return digits.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3')
  }
  return digits.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3')
}

/**
 * Formata número da OS: 1 → OS-2026-0001
 */
export function formatOSNumber(num: number, year?: number): string {
  const y = year ?? new Date().getFullYear()
  return `OS-${y}-${String(num).padStart(4, '0')}`
}

/**
 * Formata data para PT-BR
 */
export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat('pt-BR').format(new Date(date))
}

/**
 * Formata data e hora para PT-BR
 */
export function formatDateTime(date: Date | string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(date))
}

/**
 * Tempo relativo: "há 2 horas", "há 3 dias"
 */
export function timeAgo(date: Date | string): string {
  const now = new Date()
  const past = new Date(date)
  const diffMs = now.getTime() - past.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffH = Math.floor(diffMin / 60)
  const diffD = Math.floor(diffH / 24)

  if (diffMin < 1) return 'agora'
  if (diffMin < 60) return `há ${diffMin} min`
  if (diffH < 24) return `há ${diffH}h`
  if (diffD < 30) return `há ${diffD} dias`
  return formatDate(past)
}
