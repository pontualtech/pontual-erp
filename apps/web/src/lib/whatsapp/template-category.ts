// Categoriza um template WhatsApp pra o gate de conformidade Meta (15/06).
// - auth: OTP/login (transacional, sempre permitido)
// - utility: update transacional sobre a OS/serviço do PRÓPRIO cliente
//   (status, orçamento, pronto, coleta, cobrança, OS aberta, "a caminho", rota)
// - marketing: nurture, avaliação/feedback COM incentivo (cupom/Google), e
//   QUALQUER nome desconhecido (default conservador — fica OFF até classificar).
//
// Default conservador: um template novo não-classificado cai em 'marketing'
// (bloqueado), evitando reabrir o vetor de spam sem revisão.
//
// EXCEÇÃO (2026-06-22): pt_avaliacao_google_v6 é o template de feedback NEUTRO
// (sem cupom/Google/desconto na mensagem; o cupom só aparece após o clique).
// A Meta o classificou como UTILITY — então é transacional/compliant e entra
// no UTILITY_RE. Os demais avaliacao/feedback (v1/v2/v5) seguem marketing.

export type TemplateCategory = 'auth' | 'utility' | 'marketing'

const AUTH_RE = /otp|auth|c[oó]digo/i
const UTILITY_RE = /status[_-]?os|or[cç]amento|pronto|coleta|cobranca|cobran[çc]a|os[_-]?aberta|a[_-]?caminho|rota[_-]?iniciada|pt_avaliacao_google_v6/i

export function templateCategory(name: string | null | undefined): TemplateCategory {
  const n = (name || '').toString()
  if (AUTH_RE.test(n)) return 'auth'
  if (UTILITY_RE.test(n)) return 'utility'
  return 'marketing'
}
