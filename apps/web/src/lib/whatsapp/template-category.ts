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
// EXCEÇÃO: pt_avaliacao_google_v6/v7 e pt_avaliacao_google_lembrete_v1 são os
// templates de feedback NEUTROS (sem cupom/Google/desconto na mensagem; o cupom
// só aparece após o clique). A Meta os classificou como UTILITY — transacionais/
// compliant — então entram no UTILITY_RE. Os avaliacao antigos (v1/v2/v3/v5)
// lideram com incentivo no corpo e seguem marketing.
// ⚠️ FOOTGUN: cada versão nova (v8, lembrete_v2...) PRECISA ser adicionada aqui
// e no template-category.test.ts, senão cai no default 'marketing' e o gate de
// conformidade BLOQUEIA o envio silenciosamente (regressão 2026-07-30: v7 subiu
// sem entrar aqui → passe 1 e o lembrete ficaram ~13h mudos).

export type TemplateCategory = 'auth' | 'utility' | 'marketing'

const AUTH_RE = /otp|auth|c[oó]digo/i
const UTILITY_RE = /status[_-]?os|or[cç]amento|pronto|coleta|cobranca|cobran[çc]a|os[_-]?aberta|a[_-]?caminho|rota[_-]?iniciada|pt_avaliacao_google_(?:v6|v7|lembrete_v1)/i

export function templateCategory(name: string | null | undefined): TemplateCategory {
  const n = (name || '').toString()
  if (AUTH_RE.test(n)) return 'auth'
  if (UTILITY_RE.test(n)) return 'utility'
  return 'marketing'
}
