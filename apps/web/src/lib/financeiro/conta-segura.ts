// A conta bancária guarda credenciais do gateway em provider_config (ex.: api_key de produção do Asaas e
// webhook_token). Elas são usadas só no servidor (lib/payments/factory) e NUNCA podem ir para o navegador.
// Achado 29/10: GET /api/financeiro/contas-bancarias devolvia a chave do Asaas para qualquer usuário do financeiro.
const SEGREDO = /key|token|secret|senha|password/i

/** Cópia da conta sem segredos: cada campo sensível vira "<campo>_configurado: true". Não altera o original. */
export function contaSemSegredos<T extends { provider_config?: unknown }>(conta: T): T {
  const cfg = conta.provider_config
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return conta
  const limpo: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(cfg as Record<string, unknown>)) {
    if (SEGREDO.test(k)) { if (v) limpo[`${k}_configurado`] = true } else limpo[k] = v
  }
  return { ...conta, provider_config: limpo }
}
