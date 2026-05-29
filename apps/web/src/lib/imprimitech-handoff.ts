import { prisma } from '@pontual/db'

/**
 * Handoff PontualTech → Imprimitech (2026-05-29).
 *
 * Quando operador da PT muda OS pro status "Imprimitech", essa OS sai da
 * jornada da PT — foi reaberta na IMP sob outro número. Efeitos:
 *
 *   1. Portal PT esconde essa OS específica da listagem do cliente
 *      (outras OS PT do mesmo cliente continuam visíveis).
 *   2. Detalhe direto da OS no portal PT retorna 404 (não vaza dados).
 *   3. Bot Marta (PT WhatsApp) detecta OS Imprim do phone e responde
 *      "essa OS agora é com Aline" + transfere humano, sem chamar LLM.
 *   4. Cron payment-reminders-v2 (trio AE) pula AR vinculadas a OS Imprim
 *      (outros crons já filtram naturalmente por status_id/is_final).
 *
 * Cliente NÃO perde acesso ao portal inteiro — só a essa OS. Mantém UX
 * consistente se ele tem histórico legítimo de outras OS na PT.
 */

export const IMPRIMITECH_HANDOFF_STATUS_NAME = 'Imprimitech'

/**
 * Match tolerante (acentos/caixa) — protege contra rename casual via UI.
 * Ex: "Imprimitech", "imprimitech", "IMPRIMITECH" todos retornam true.
 * Não é case do código: o status oficial é "Imprimitech" exato; tolerância
 * só pra defender se alguém editar via /config/status sem perceber.
 */
export function isImprimitechHandoffStatus(name: string | null | undefined): boolean {
  if (!name) return false
  const normalized = name.trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  return normalized === 'imprimitech'
}

// Per-process cache pra não bater no DB em todo request. Status ID estável
// (não muda em runtime), TTL longo (1h) é seguro. Cache miss → 1 query.
const statusIdCache = new Map<string, { id: string | null; ts: number }>()
const CACHE_TTL_MS = 60 * 60 * 1000

/**
 * Resolve o status_id do "Imprimitech" pra essa empresa. Retorna null se
 * a empresa não tem esse status (ex: Imprimitech-001 não tem; só PT-001).
 * Cached 1h por company_id.
 */
export async function getImprimitechHandoffStatusId(companyId: string): Promise<string | null> {
  const cached = statusIdCache.get(companyId)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.id

  const status = await prisma.moduleStatus.findFirst({
    where: { company_id: companyId, module: 'os', name: IMPRIMITECH_HANDOFF_STATUS_NAME },
    select: { id: true },
  })
  const id = status?.id || null
  statusIdCache.set(companyId, { id, ts: Date.now() })
  return id
}

/**
 * Mensagem padrão enviada ao cliente que tenta falar com a PT sobre uma
 * OS já transferida. Cliente vê via WhatsApp da PT antes do bot Marta
 * acionar a LLM. Resolve a conversa e transfere pra humano (atendente
 * acompanha o caso pra evitar cliente perdido).
 */
export function buildImprimitechHandoffMessage(args: {
  osNumber: number
  customerFirstName?: string | null
  imprimitechWhatsApp?: string | null
}): string {
  const nome = (args.customerFirstName || '').trim() || 'Olá'
  const contato = args.imprimitechWhatsApp
    ? `\n\n💬 Fale com a equipe Imprimitech pelo WhatsApp:\n${args.imprimitechWhatsApp}`
    : ''
  return `Oi, ${nome}! Sua OS #${args.osNumber} foi transferida pra nossa parceira *Imprimitech*. A partir de agora, o atendimento desse equipamento segue por lá (sob outro número de OS).${contato}\n\nQualquer outra dúvida sobre serviços da PontualTech, é só me chamar! 😊`
}
