/**
 * Livro-razão — deriva o padrão de uma regra de classificação a partir do texto da linha do banco.
 * Função pura (usada também em componente client): sem imports de servidor.
 *
 * Invariante: todo resultado não nulo é substring contígua de `texto.toUpperCase()`,
 * pois `classificar` casa por substring. Por isso não removemos acentos nem colapsamos espaços internos.
 */
const PREFIXOS =
  /^\s*(?:PIX ENVIADO|PIX RECEBIDO|PIX QRS|TRANSA[ÇC][ÃA]O VIA PIX COM (?:CHAVE|QR CODE|DADOS MANUAIS) PARA|PAGAMENTO|PAG BOLETO|TED|DOC|SISPAG)(?![\p{L}\d])\s*/u

const PROIBIDOS = new Set([
  'PIX', 'TED', 'DOC', 'TAR', 'TARIFA', 'BOLETO', 'TRANSF', 'PAGAMENTO', 'RECEBIDO', 'ENVIADO',
])

const letras = (s: string) => (s.match(/\p{L}/gu) ?? []).length

export function padraoDaLinha(texto: string): string | null {
  let t = texto.toUpperCase().replace(PREFIXOS, '')
  // Data colada no fim (ex.: "ROGERIO29/10").
  t = t.replace(/\d{2}\/\d{2}$/, '')
  // Números longos (≥5 dígitos) separam segmentos; fica o segmento com mais letras.
  const segmentos = t.split(/\d{5,}/).map((s) => s.trim())
  let melhor = ''
  for (const s of segmentos) if (letras(s) > letras(melhor)) melhor = s
  if (letras(melhor) < 4 || PROIBIDOS.has(melhor)) return null
  return melhor
}
