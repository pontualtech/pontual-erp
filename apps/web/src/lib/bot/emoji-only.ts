/**
 * Detecta mensagem composta APENAS de emoji (figurinha implicita).
 *
 * Bug corrigido (auditoria bots): a regex antiga /^[\p{Emoji}\s]+$/u marcava
 * NUMEROS como emoji — a propriedade Unicode `Emoji` inclui os digitos 0-9,
 * '#' e '*' (componentes de keycap como 1️⃣). CEP "09931280" e numero de casa
 * "699" viravam "[HINT: cliente enviou apenas emoji/figurinha]".
 *
 * `Extended_Pictographic` cobre os emojis pictoricos de verdade (👍 ❤ 🙏 😂)
 * SEM incluir digitos. Aceitamos tambem os modificadores que acompanham
 * emoji: variation selector (FE0F/FE0E), tons de pele (1F3FB-1F3FF via
 * Emoji_Modifier), ZWJ (200D) e whitespace.
 */
const EMOJI_ONLY_RE = /^(?:[\p{Extended_Pictographic}\p{Emoji_Modifier}\u{FE0E}\u{FE0F}\u{200D}]|\s)+$/u

export function isEmojiOnlyMessage(content: string): boolean {
  const t = content.trim()
  if (!t) return false
  return EMOJI_ONLY_RE.test(t)
}
