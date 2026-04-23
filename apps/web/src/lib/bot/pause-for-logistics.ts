import 'server-only'
import { prisma } from '@pontual/db'

/**
 * Pausa o bot (Ana/Marta/Aline) em uma conversa específica, pra quando
 * o motorista manda uma notificação de logística e o cliente responde —
 * bot nao deve responder, humano (Grazi etc) atende.
 *
 * Uso tipico (fire-and-forget, nao bloqueante):
 *   void pauseBotForLogistics(companyId, phone, 'a-caminho').catch(() => {})
 *
 * Comportamento:
 *   1. Le setting 'logistics.handover_bot.enabled' — se 'false', no-op.
 *   2. Normaliza o phone (so digits, com e sem prefixo 55).
 *   3. Procura BotConversation ativa por customer_phone.
 *   4. Se achar, seta human_takeover=true + step='HUMAN'.
 *   5. NUNCA cria BotConversation — so pausa se ja existe.
 *   6. Qualquer erro e silenciado via try/catch — NAO quebra o caller.
 *
 * Bot volta a atender automaticamente quando o humano resolver a
 * conversa no Chatwoot (evento conversation_status_changed -> reset).
 */
export async function pauseBotForLogistics(
  companyId: string,
  phone: string | null | undefined,
  reason: string,
): Promise<{ paused: boolean; reason?: string }> {
  try {
    if (!phone) return { paused: false, reason: 'no-phone' }

    // Setting toggle — default TRUE. Se setar 'false', helper vira no-op.
    const setting = await prisma.setting.findFirst({
      where: { company_id: companyId, key: 'logistics.handover_bot.enabled' },
      select: { value: true },
    }).catch(() => null)
    if (setting?.value === 'false') {
      return { paused: false, reason: 'disabled-by-setting' }
    }

    // Normaliza telefone — tenta varias formas porque BotConversation pode
    // ter guardado com prefixo 55, sem prefixo, com/sem 9 extra.
    const digits = String(phone).replace(/\D/g, '')
    if (digits.length < 10) return { paused: false, reason: 'invalid-phone' }
    const variants = new Set<string>()
    variants.add(digits)
    if (digits.startsWith('55')) variants.add(digits.slice(2))
    else variants.add('55' + digits)
    // Tenta tambem com/sem o 9 apos DDD (padrao BR mobile)
    if (digits.length === 13 && digits.startsWith('55')) {
      // 55 + DDD(2) + 9 + 8digitos
      variants.add(digits.slice(0, 4) + digits.slice(5))
    } else if (digits.length === 12 && digits.startsWith('55')) {
      // 55 + DDD(2) + 8digitos -> tenta adicionar 9
      variants.add(digits.slice(0, 4) + '9' + digits.slice(4))
    }

    const conv = await prisma.botConversation.findFirst({
      where: {
        company_id: companyId,
        customer_phone: { in: Array.from(variants) },
        human_takeover: false, // so pausa se esta ativa
      },
      select: { id: true, chatwoot_conv_id: true },
      orderBy: { updated_at: 'desc' },
    })

    if (!conv) {
      return { paused: false, reason: 'no-active-conversation' }
    }

    await prisma.botConversation.update({
      where: { id: conv.id },
      data: { human_takeover: true, step: 'HUMAN' },
    })

    console.log(`[pauseBotForLogistics] conv ${conv.id} paused (chatwoot=${conv.chatwoot_conv_id}) reason=${reason}`)
    return { paused: true }
  } catch (err) {
    // NUNCA deixa o erro propagar — helper e fire-and-forget.
    console.warn('[pauseBotForLogistics] silent error:', err instanceof Error ? err.message : String(err))
    return { paused: false, reason: 'error' }
  }
}
