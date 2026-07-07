// Detecção de opt-out de follow-up por palavra-CHAVE INTEIRA (não substring).
// Auditoria 07/07: o `.includes(kw)` disparava falso-positivo — "pare" é
// substring de "aparelho", então "meu aparelho não liga" desativava os avisos
// do cliente. Aqui a keyword precisa aparecer delimitada (bordas Unicode),
// cobrindo acento do PT-BR (\b do JS não trata acento).

export function hasOptOutKeyword(content: string, keywords: string[]): boolean {
  const text = (content || '').toLowerCase().trim()
  if (!text) return false
  return keywords.some((raw) => {
    const kw = (raw || '').trim().toLowerCase()
    if (!kw) return false
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // borda = início/fim OU um caractere que não é letra/número (Unicode)
    const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${esc}(?:[^\\p{L}\\p{N}]|$)`, 'iu')
    return re.test(text)
  })
}
