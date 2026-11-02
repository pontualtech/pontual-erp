import { z } from 'zod'

// Aceita data ISO completa ou YYYY-MM-DD; texto que não é data → erro de validação (422), não 500 lá na frente.
const dateStringOptional = z.string().optional().transform((v) => {
  if (!v) return v
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v}T00:00:00.000Z`
  return v
}).refine((v) => !v || !Number.isNaN(Date.parse(v)), 'Data inválida')

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
  // Fix 7 (F7-D): resposta do operador quando a conta já tem dinheiro lançado — 'novo' (outro pagamento: lança) ou
  // 'mesmo' (é o dinheiro já lançado: só marca recebida). Sem ela, a rota pergunta (409 DINHEIRO_JA_LANCADO).
  dinheiro: z.enum(['novo', 'mesmo']).optional(),
})
