/**
 * Sentinela de saúde do WhatsApp no Relatório do Comandante (09/10/2026).
 *
 * A Meta restringiu a conta por spam (já tinha avisado em 10/06) e ninguém
 * viu a tempo: os bots ficaram mudos horas antes de alguém perceber. Esta
 * função transforma o estado da conta + as travas anti-spam em uma lista de
 * problemas legíveis; lista vazia = tudo certo.
 */
export type WhatsappHealthInput = {
  phones: { nome: string; status: string; quality: string }[]
  /** null = não foi possível consultar a Meta */
  waba: { canSend: string; erros: string[] } | null
  followupLigado: boolean
  marketingLigado: boolean
  /**
   * Mensagens de saída que o Chatwoot marcou como "failed" nas últimas 24h.
   * É o sinal confiável de restrição: a Meta NÃO expõe a restrição por spam na
   * API (health_status segue AVAILABLE e restriction_info vem vazio), mas o
   * envio falha com 131031 "Business Account locked".
   */
  falhasEntrega24h?: { total: number; erro: string }
}

export function avaliarSaudeWhatsapp(i: WhatsappHealthInput): string[] {
  const problemas: string[] = []

  if (!i.waba) {
    problemas.push('Não consegui consultar a Meta — status do WhatsApp desconhecido (token expirado?)')
  } else if (i.waba.canSend !== 'AVAILABLE') {
    const motivo = i.waba.erros.length ? ` — ${i.waba.erros.join('; ')}` : ''
    problemas.push(`Conta WhatsApp ${i.waba.canSend} pela Meta${motivo}`)
  }

  for (const p of i.phones) {
    if (p.status !== 'CONNECTED') problemas.push(`Número ${p.nome} está ${p.status}`)
    if (p.quality === 'RED') problemas.push(`Número ${p.nome} com qualidade RED (risco de restrição)`)
    else if (p.quality === 'YELLOW') problemas.push(`Número ${p.nome} com qualidade YELLOW (atenção)`)
  }

  if (i.falhasEntrega24h && i.falhasEntrega24h.total > 0) {
    problemas.push(`${i.falhasEntrega24h.total} mensagem(ns) do WhatsApp FALHARAM na entrega nas últimas 24h — ${i.falhasEntrega24h.erro} (clientes sem resposta; pode ser restrição da Meta)`)
  }

  if (i.followupLigado) problemas.push('Follow-up automático do bot está LIGADO (causou a restrição de 09/10)')
  if (i.marketingLigado) problemas.push('Marketing por WhatsApp está LIGADO (causou o aviso de 10/06)')

  return problemas
}
