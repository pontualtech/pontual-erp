// Categoriza um template WhatsApp pra o gate de conformidade Meta (15/06).
// - auth: OTP/login (transacional, sempre permitido)
// - utility: update transacional sobre a OS/serviço do PRÓPRIO cliente
//   (status, orçamento, pronto, coleta, cobrança, OS aberta, "a caminho", rota)
// - marketing: nurture, avaliação/feedback, follow-up de re-engajamento, e
//   QUALQUER nome desconhecido (default conservador — fica OFF até classificar).
//
// Default conservador: um template novo não-classificado cai em 'marketing'
// (bloqueado), evitando reabrir o vetor de spam sem revisão.

export type TemplateCategory = 'auth' | 'utility' | 'marketing'

const AUTH_RE = /otp|auth|c[oó]digo/i
const UTILITY_RE = /status[_-]?os|or[cç]amento|pronto|coleta|cobranca|cobran[çc]a|os[_-]?aberta|a[_-]?caminho|rota[_-]?iniciada/i

export function templateCategory(name: string | null | undefined): TemplateCategory {
  const n = (name || '').toString()
  if (AUTH_RE.test(n)) return 'auth'
  if (UTILITY_RE.test(n)) return 'utility'
  return 'marketing'
}
