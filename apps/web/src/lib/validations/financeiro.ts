import { z } from 'zod'

/**
 * Schema para baixa de conta a receber
 */
export const baixaSchema = z.object({
  received_amount: z.number().int().positive('Valor recebido deve ser positivo'),
  received_at: z.string().datetime().optional(),
  account_id: z.string().uuid().optional(),
})
