import { z } from 'zod'

// Aceita data ISO completa ou YYYY-MM-DD
const dateStringOptional = z.string().optional().transform((v) => {
  if (!v) return v
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v}T00:00:00.000Z`
  return v
})

/**
 * Schema para baixa de conta a receber
 */
export const baixaSchema = z.object({
  received_amount: z.number().int().positive('Valor recebido deve ser positivo'),
  received_at: dateStringOptional,
  account_id: z.string().uuid().optional(),
})
