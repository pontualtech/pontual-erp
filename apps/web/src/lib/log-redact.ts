/**
 * N20 fix (audit pos-fix): helpers de redaction pra logs.
 *
 * LGPD Art.46/48 + Art.52: PII em logs sem mascaramento expõe a empresa
 * a multa de 2% do faturamento (max R$ 50M). Logs do Coolify vão pra
 * stdout do container → potencialmente terceiros (suporte Coolify/Hetzner).
 *
 * Uso:
 *   console.log(`[Bot] customer=${redactName(name)} doc=${redactDoc(cpf)}`)
 *   console.log(`[OS] order=${osNum} customer=${redactCustomer(c)}`)
 */

/** CPF/CNPJ → 4 primeiros + ***. Ex: "12345678901" → "1234***" */
export function redactDoc(doc: string | null | undefined): string {
  if (!doc) return ''
  const digits = String(doc).replace(/\D/g, '')
  if (digits.length < 4) return '***'
  return digits.slice(0, 4) + '***'
}

/** Telefone → DDD + últimos 2 dígitos. Ex: "11987654321" → "11****21" */
export function redactPhone(phone: string | null | undefined): string {
  if (!phone) return ''
  const digits = String(phone).replace(/\D/g, '')
  if (digits.length < 4) return '***'
  return digits.slice(0, 2) + '****' + digits.slice(-2)
}

/** Email → primeiras 2 chars + ***@domain. Ex: "joao.silva@gmail.com" → "jo***@gmail.com" */
export function redactEmail(email: string | null | undefined): string {
  if (!email) return ''
  const at = email.indexOf('@')
  if (at < 0) return '***'
  const local = email.slice(0, at)
  const domain = email.slice(at)
  if (local.length <= 2) return local[0] + '***' + domain
  return local.slice(0, 2) + '***' + domain
}

/** Nome → primeiro nome + iniciais. Ex: "JOAO DA SILVA" → "JOAO ***" */
export function redactName(name: string | null | undefined): string {
  if (!name) return ''
  const parts = String(name).trim().split(/\s+/)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ***`
}

/** Helper composto pra logar customer com PII redacted */
export function redactCustomer(c: { legal_name?: string | null; mobile?: string | null; phone?: string | null; email?: string | null; document_number?: string | null } | null | undefined): string {
  if (!c) return '<null>'
  const parts: string[] = []
  if (c.legal_name) parts.push(`name=${redactName(c.legal_name)}`)
  if (c.document_number) parts.push(`doc=${redactDoc(c.document_number)}`)
  const phone = c.mobile || c.phone
  if (phone) parts.push(`phone=${redactPhone(phone)}`)
  if (c.email) parts.push(`email=${redactEmail(c.email)}`)
  return parts.join(' ')
}
