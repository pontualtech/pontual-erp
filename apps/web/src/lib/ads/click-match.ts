/**
 * Portão de envio de VENDA ao Google Ads (10/10/2026).
 *
 * O bot (chatwoot/bot) liga conversa→clique por "fingerprint": pega o clique de WhatsApp
 * mais recente dos últimos 15 min, sem conferir caixa nem se a conversa é nova — e, como só
 * olha a cópia volátil `data.attribution`, reescreve a origem de conversas em andamento com o
 * clique de outra pessoa (1.209 conversas consumiram mais de 1 clique). Auditoria de 10/10:
 * das 109 vendas enviadas em 08/10, só ~26 tinham o clique comprovadamente do cliente; as
 * demais ensinavam a PMax que clique barato de terceiro vende.
 *
 * A prova é ancorada no CLIQUE (marketing_whatsapp_redirects) e no DONO dele (conversa do
 * próprio cliente da OS, pelo telefone) — não na origem atual da conversa, que pode ter sido
 * reescrita. Só passa venda cujo clique:
 *   - veio pela etiqueta [ref:] numa conversa do cliente, antes da OS; ou
 *   - foi consumido por conversa NOVA do cliente numa caixa de venda, era o ÚNICO clique livre
 *     na janela do fingerprint naquele instante, teve a 1ª mensagem até 3 min depois e a OS foi
 *     aberta depois do clique;
 * e desde que o mesmo gclid não esteja na OS de outro cliente nem tenha sido consumido pela
 * conversa nova de outro cliente (disputa = não dá para saber de quem é).
 * Na dúvida, não envia (lado seguro): venda com clique errado é pior que venda a menos.
 */

export const CLICK_TO_MESSAGE_MAX_MS = 3 * 60 * 1000
// click_at, created_at e consumed_at vêm do mesmo servidor/banco: a folga só cobre arredondamento.
export const CLOCK_TOLERANCE_MS = 5 * 1000
export const FINGERPRINT_WINDOW_MS = 15 * 60 * 1000 // mesma janela do fingerprint do bot

export type ClickMatchReason =
  | 'etiqueta'
  | 'exato'
  | 'gclid_em_outra_os'
  | 'clique_compartilhado'
  | 'clique_de_outro_cliente'
  | 'sem_conversa_do_cliente'
  | 'clique_desconhecido'
  | 'clique_nao_consumido'
  | 'conversa_antiga'
  | 'mensagem_tardia'
  | 'varios_cliques'
  | 'os_antes_do_clique'
  | 'caixa_nao_venda'
  | 'caixa_desconhecida'
  | 'erro'

export interface ClickRow {
  clickAt: Date
  consumedAt: Date | null
  consumedByConvId: number | null
}

export interface CustomerConsumption {
  clickAt: Date
  consumedAt: Date | null
  /** Caixa REAL da conversa (o ERP às vezes grava inbox_id nulo — resolver no Chatwoot antes). */
  conversation: { inboxId: number | null; createdAt: Date }
}

export interface ClickMatchInput {
  /** Linhas de clique com o gclid da OS. */
  clicks: ClickRow[]
  /** Conversas do cliente da OS (chatwoot_conv_id, achadas pelo telefone). */
  customerConvIds: Set<number>
  /** Outras OS, de OUTRO cliente, com o mesmo gclid. */
  otherCustomerOsWithGclid: number
  /** Linhas desse gclid consumidas, até 3 min após o clique, por conversa NOVA de outro cliente. */
  otherNewConsumers: number
  /** Conversas (de qualquer cliente) com esse gclid vindo da etiqueta [ref:]. */
  tokenConvs: Array<{ chatwootConvId: number; capturedAt: Date | null }>
  /** 1º consumo do clique por conversa do cliente (ver pickCustomerConsumption). */
  consumption: CustomerConsumption | null
  /** Outros cliques livres na janela do fingerprint no instante desse consumo (sem o mesmo gclid). */
  freeClicksInWindow: number
  osCreatedAt: Date | null
  /** Caixas da Ana (setting bot.config.allowed_inboxes). */
  salesInboxes: Set<number>
}

/** 1º consumo (mais antigo) do clique feito por uma conversa do próprio cliente. */
export function pickCustomerConsumption<T extends ClickRow>(clicks: T[], customerConvIds: Set<number>): T | null {
  const mine = clicks.filter(c => c.consumedByConvId != null && customerConvIds.has(c.consumedByConvId) && c.consumedAt)
  mine.sort((a, b) => a.consumedAt!.getTime() - b.consumedAt!.getTime())
  return mine[0] || null
}

export function decideClickMatch(input: ClickMatchInput): { ok: boolean; reason: ClickMatchReason } {
  const { clicks, customerConvIds, tokenConvs, consumption, freeClicksInWindow, osCreatedAt, salesInboxes } = input

  // 1) Etiqueta [ref:] do próprio cliente: prova de 1ª mão — vence disputa (o bot não consome o
  //    clique de quem veio pela etiqueta, então o fingerprint pode tê-lo dado a outra conversa).
  //    Só exige ser anterior à OS; referência = 1º clique registrado (o bot regrava captured_at).
  const myToken = tokenConvs.find(t => customerConvIds.has(t.chatwootConvId))
  if (myToken) {
    const firstClick = clicks.length ? Math.min(...clicks.map(c => c.clickAt.getTime())) : myToken.capturedAt?.getTime()
    if (firstClick == null || !osCreatedAt || osCreatedAt.getTime() < firstClick - CLOCK_TOLERANCE_MS) {
      return { ok: false, reason: 'os_antes_do_clique' }
    }
    return { ok: true, reason: 'etiqueta' }
  }

  // Disputa entre clientes: o mesmo gclid não pode ser de dois — não dá para saber de quem é.
  if (input.otherCustomerOsWithGclid > 0) return { ok: false, reason: 'gclid_em_outra_os' }
  if (input.otherNewConsumers > 0) return { ok: false, reason: 'clique_compartilhado' }
  if (tokenConvs.length > 0) return { ok: false, reason: 'clique_de_outro_cliente' } // etiqueta é de outro

  // 2) Fingerprint: o clique tem de ter sido consumido por conversa do próprio cliente.
  if (!consumption) {
    if (customerConvIds.size === 0) return { ok: false, reason: 'sem_conversa_do_cliente' }
    if (clicks.length === 0) return { ok: false, reason: 'clique_desconhecido' }
    const consumedByOthers = clicks.some(c => c.consumedByConvId != null)
    return { ok: false, reason: consumedByOthers ? 'clique_de_outro_cliente' : 'clique_nao_consumido' }
  }

  const click = consumption.clickAt.getTime()
  if (consumption.conversation.createdAt.getTime() < click - CLOCK_TOLERANCE_MS) return { ok: false, reason: 'conversa_antiga' }
  if (!consumption.consumedAt || consumption.consumedAt.getTime() - click > CLICK_TO_MESSAGE_MAX_MS) {
    return { ok: false, reason: 'mensagem_tardia' }
  }
  if (freeClicksInWindow > 0) return { ok: false, reason: 'varios_cliques' }
  if (!osCreatedAt || osCreatedAt.getTime() < click - CLOCK_TOLERANCE_MS) return { ok: false, reason: 'os_antes_do_clique' }

  // Caixa por último: quando o ERP não gravou inbox_id, quem chama resolve no Chatwoot só se
  // todo o resto passou (poucas chamadas) e decide de novo.
  const inbox = consumption.conversation.inboxId
  if (inbox == null) return { ok: false, reason: 'caixa_desconhecida' }
  if (!salesInboxes.has(inbox)) return { ok: false, reason: 'caixa_nao_venda' }

  return { ok: true, reason: 'exato' }
}
