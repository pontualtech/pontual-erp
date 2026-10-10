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
  /** Templates cuja qualidade a Meta rebaixou (ex.: 'pt_cobranca_v3:RED') */
  templatesRuins?: string[]
  /** Mensagem de detectarPicoDeVolume, quando o volume de ontem fugiu do padrão */
  picoVolume?: string | null
}

const PICO_FATOR = 1.3
const PICO_MINIMO = 400
const HISTORICO_MINIMO_DIAS = 7

/**
 * Pico de volume de envio: alerta precoce de loop/disparo em massa (a restrição
 * de 09/10/2026 veio depois de dias de envio acima do necessário).
 * `porDia` em ordem cronológica; o ÚLTIMO elemento é o dia fechado mais recente
 * e os anteriores formam o histórico. Dispara quando o dia passa 30% do MAIOR
 * dia do histórico E tem pelo menos 400 mensagens — fim de semana e conta
 * restrita (volume baixo) nunca alertam, e pouco histórico não gera falso alarme.
 */
export function detectarPicoDeVolume(porDia: number[]): string | null {
  if (porDia.length < HISTORICO_MINIMO_DIAS + 1) return null
  const ontem = porDia[porDia.length - 1]
  const historico = porDia.slice(-1 - HISTORICO_MINIMO_DIAS, -1)
  const maximo = Math.max(...historico)
  if (ontem >= PICO_MINIMO && ontem > maximo * PICO_FATOR) {
    return `Volume de ontem (${ontem} mensagens) passou 30% do maior dia da semana anterior (${maximo}) — conferir se algo está disparando em massa`
  }
  return null
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

  for (const t of i.templatesRuins ?? []) problemas.push(`Template com qualidade rebaixada pela Meta: ${t}`)
  if (i.picoVolume) problemas.push(i.picoVolume)

  if (i.followupLigado) problemas.push('Follow-up automático do bot está LIGADO (causou a restrição de 09/10)')
  if (i.marketingLigado) problemas.push('Marketing por WhatsApp está LIGADO (causou o aviso de 10/06)')

  return problemas
}
