/**
 * Política de follow-up automático do bot (09/10/2026).
 *
 * A Meta restringiu a conta WhatsApp da PontualTech por 30 dias por spam
 * (já tinha sinalizado em 10/06 pelo mesmo motivo). Causa: follow-ups
 * automáticos ("ainda precisa de ajuda?") a leads que pararam de responder —
 * o setting tinha sido desligado em junho e foi religado sem ninguém notar.
 *
 * Por isso a regra mora no CÓDIGO, não só no setting: WhatsApp (Cloud API ou
 * via Evolution/Channel::Api) nunca recebe follow-up automático, mesmo que
 * alguém religue o toggle. Lista de PERMITIDOS (não de proibidos): canal novo
 * ou desconhecido nasce bloqueado.
 */
const CANAIS_PERMITIDOS = new Set(['Channel::WebWidget', 'Channel::Email'])

export function isFollowUpAllowedForChannel(channelType: string | null | undefined): boolean {
  return !!channelType && CANAIS_PERMITIDOS.has(channelType)
}
