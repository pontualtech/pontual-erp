import { z } from 'zod'

// Aceita data ISO completa ou YYYY-MM-DD
const dateStringOptional = z.string().optional().transform((v) => {
  if (!v) return v
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v}T00:00:00.000Z`
  return v
})

/**
 * Schema para baixa de conta a receber.
 *
 * 2026-05-22: account_id passou a ser OBRIGATORIO. Antes era optional e
 * permitia AR marcado RECEBIDO sem nenhuma Transaction associada — dinheiro
 * "entrava" no sistema sem ir pra conta nenhuma, quebrando DRE, extrato,
 * fluxo de caixa e conciliacao. ARs antigos sem account_id continuam
 * existindo mas nao da pra fazer NOVA baixa parcial sem informar conta.
 */
export const baixaSchema = z.object({
  received_amount: z.number().int().positive('Valor recebido deve ser positivo'),
  received_at: dateStringOptional,
  account_id: z.string().uuid('Conta bancaria/caixa obrigatoria'),
})
