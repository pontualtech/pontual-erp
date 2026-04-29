/**
 * Normalização de telefones brasileiros + lookup de cliente por phone.
 *
 * Formato canônico: só dígitos, com DDD obrigatório, SEM +55.
 * Exemplos:
 *   "(12) 9 8700-5380" → "12987005380"
 *   "+55 12 9 8700 5380" → "12987005380"
 *   "01298700-5380" → "12987005380" (strip leading 0)
 *   "98700-5380" → "1198700-5380" → "11987005380" (assume DDD 11 SP)
 *
 * Match flexível: gera várias representações pra busca em customer.phone/mobile
 * que pode estar em formato sujo no DB (importação VHSys legacy).
 */

export function normalizePhone(input: string | null | undefined): string {
  if (!input) return ''
  let digits = String(input).replace(/\D/g, '')

  // Strip +55 ou 55 prefix de country code se número tem 12-13 dígitos
  if (digits.length === 12 && digits.startsWith('55')) {
    digits = digits.slice(2)
  } else if (digits.length === 13 && digits.startsWith('55')) {
    digits = digits.slice(2)
  }

  // Strip leading 0 (estilo DDD tradicional 0+11+...)
  if (digits.length > 10 && digits.startsWith('0')) {
    digits = digits.slice(1)
  }

  return digits
}

/**
 * Gera múltiplas variações de busca pra match no DB.
 * O DB pode ter telefone armazenado em vários formatos.
 *
 * Para "12987005380" retorna:
 *   - "12987005380" (canônico)
 *   - "1287005380" (sem 9º dígito mobile)
 *   - "987005380" (sem DDD)
 *   - "+5512987005380"
 */
export function getPhoneSearchVariants(normalized: string): string[] {
  if (!normalized) return []
  const variants = new Set<string>([normalized])

  // 11 dígitos (celular DDD+9+8): adiciona variante sem 9º dígito (legado pré-2016)
  if (normalized.length === 11) {
    variants.add(normalized.slice(0, 2) + normalized.slice(3))  // remove 9º dig
    variants.add(normalized.slice(2))  // sem DDD
  }

  // 10 dígitos (fixo DDD+8 OU celular antigo): adiciona variante com 9º
  if (normalized.length === 10) {
    variants.add(normalized.slice(0, 2) + '9' + normalized.slice(2))
    variants.add(normalized.slice(2))
  }

  // E.164
  variants.add('+55' + normalized)
  variants.add('55' + normalized)

  return Array.from(variants)
}

/**
 * Compara 2 telefones com tolerância (ignora 9º dígito, country code).
 */
export function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizePhone(a)
  const nb = normalizePhone(b)
  if (!na || !nb) return false
  if (na === nb) return true

  // Match parcial: últimos 8 dígitos batem (ignora DDD + 9º)
  const tailA = na.slice(-8)
  const tailB = nb.slice(-8)
  return tailA === tailB && tailA.length === 8
}
