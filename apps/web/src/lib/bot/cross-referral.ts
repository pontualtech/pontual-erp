// Unidades com a loja física TEMPORARIAMENTE fechada. Enquanto uma unidade estiver aqui, o bot de
// vendas não recebe [CROSS_REFERRAL_INFO] envolvendo ela — o aviso "indique a outra unidade" mandava
// cliente para portão fechado (caso Silvina, PT conv 23489, 16/10/2026).
// Imprimitech (Vila California) fechada desde 15/10/2026 (Karlão). ESVAZIAR quando a loja reabrir.
export const UNIDADES_FECHADAS: readonly string[] = ['86c829cf-32ed-4e40-80cd-59ce4178aa1a']

export function crossReferralSuspenso(
  companyId: string,
  otherCompanyId: string,
  fechadas: readonly string[] = UNIDADES_FECHADAS,
): boolean {
  return fechadas.includes(companyId) || fechadas.includes(otherCompanyId)
}
