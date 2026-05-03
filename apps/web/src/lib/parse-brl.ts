/**
 * UX-11 #3: parseBRL → cents conversion seguro.
 *
 * Bug que motivou: usuário digita "1.250,50" (formato BR), `parseFloat`
 * retorna 1.25 (interpreta ponto como decimal e ignora vírgula+rest).
 * Resultado: campo de preço vira R$ 1,25 em vez de R$ 1.250,50.
 *
 * Comportamento:
 *  - "1.250,50" → 125050 (cents)  ✅ formato BR completo
 *  - "1250,50"  → 125050           ✅ sem milhares
 *  - "1250.50"  → 125050           ✅ formato US
 *  - "1250"     → 125000           ✅ inteiro
 *  - "1.250"    → 125000           ✅ ambíguo "milhares" — assume BR (default)
 *  - ""/null    → null
 *  - "abc"      → null (NaN safe)
 *
 * Aplica EPSILON pra evitar IEEE-754 drift (mesmo padrão Inter UX-10 #3).
 */
export function parseBRLToCents(raw: string | number | null | undefined): number | null {
  if (raw == null) return null
  if (typeof raw === 'number') {
    if (!isFinite(raw) || isNaN(raw)) return null
    return Math.round((raw + Number.EPSILON) * 100)
  }
  const s = String(raw).trim()
  if (!s) return null

  // Detecta formato BR (vírgula como decimal): se tem vírgula, ela é o separador decimal
  let normalized: string
  if (s.includes(',')) {
    // BR: remove pontos (milhares) e troca vírgula por ponto
    normalized = s.replace(/\./g, '').replace(',', '.')
  } else if (s.includes('.')) {
    // Ambíguo: "1.250" pode ser "1250" (BR milhares) ou "1.25" (US decimal).
    // Heurística: se tem >= 4 dígitos depois de remover ponto, assume milhares BR.
    // Senão (ex: "1.5", "12.50"), trata como US decimal.
    const digits = s.replace(/\./g, '')
    const dotPos = s.lastIndexOf('.')
    const decimalsAfterLastDot = s.length - dotPos - 1
    if (decimalsAfterLastDot === 3) {
      // "1.250" → 1250 (milhares BR)
      normalized = digits
    } else if (decimalsAfterLastDot === 2 || decimalsAfterLastDot === 1) {
      // "1250.50" ou "12.5" → US decimal
      normalized = s
    } else {
      // "1.2.3.4" ou similar — fallback: remove tudo
      normalized = digits
    }
  } else {
    // Só dígitos (ou letras inválidas)
    normalized = s
  }

  const n = parseFloat(normalized)
  if (!isFinite(n) || isNaN(n)) return null
  return Math.round((n + Number.EPSILON) * 100)
}

/**
 * Inverse: cents (BigInt-safe) → string BRL display.
 */
export function centsToBRL(cents: number | bigint): string {
  const n = typeof cents === 'bigint' ? Number(cents) : cents
  if (!isFinite(n) || isNaN(n)) return 'R$ 0,00'
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(n / 100)
}
