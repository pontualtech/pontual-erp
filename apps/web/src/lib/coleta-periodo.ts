// Deriva uma etiqueta de período (MANHA/TARDE) a partir da observação livre de
// coleta/entrega que o cliente passou ao bot (ex: "só à tarde", "antes das 11h").
//
// Best-effort + determinístico (regex no servidor, não confia no LLM). O texto
// livre é a fonte da verdade — o período é só uma dica pra logística ordenar a
// rota. Quando ambíguo (ex: "antes das 15h", "fechado para almoço"), retorna
// null e a UI mostra só o texto. Usado em /api/bot/abrir-os ao gravar a OS.

export type ColetaPeriodo = 'MANHA' | 'TARDE'

export function deriveColetaPeriodo(obs: string | null | undefined): ColetaPeriodo | null {
  const t = (obs || '').toLowerCase().normalize('NFC')
  if (!t.trim()) return null

  // Tarde explícita
  if (/\btarde\b|ap[óo]s\s+o?\s*almo[çc]o|depois\s+d\w*\s+almo[çc]o|fim\s+da\s+tarde|final\s+da\s+tarde/.test(t)) {
    return 'TARDE'
  }
  // Manhã explícita
  if (/manh[ãa]|\bcedo\b|antes\s+d\w*\s+almo[çc]o|at[ée]\s+(o\s+)?meio.?dia/.test(t)) {
    return 'MANHA'
  }
  // Deadline cedo: "até/antes das ≤13h" → coletar de manhã pra não furar.
  // Deadline tardio (>13h) não indica período → null.
  const m = t.match(/(?:at[ée]|antes)\s+(?:[àa]s?|d[ao]s?|de\s)?\s*(\d{1,2})\s*(?:h|:|hr|hrs|horas)/)
  if (m) {
    const h = parseInt(m[1], 10)
    if (h >= 1 && h <= 13) return 'MANHA'
  }
  return null
}
