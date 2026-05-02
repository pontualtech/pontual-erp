import { z } from 'zod'

/**
 * Normaliza documento removendo formatação
 */
export function normalizeDocument(doc: string): string {
  return doc.replace(/[.\-\/\s]/g, '')
}

/**
 * UX-9 #3: validação dígito verificador CPF (11 dígitos)
 * Rejeita sequências triviais (00000000000, 11111111111, etc.)
 */
export function isValidCPF(d: string): boolean {
  if (!/^\d{11}$/.test(d)) return false
  if (/^(\d)\1+$/.test(d)) return false  // sequência repetida
  let s = 0
  for (let i = 0; i < 9; i++) s += +d[i] * (10 - i)
  let r = (s * 10) % 11
  if (r === 10) r = 0
  if (r !== +d[9]) return false
  s = 0
  for (let i = 0; i < 10; i++) s += +d[i] * (11 - i)
  r = (s * 10) % 11
  if (r === 10) r = 0
  return r === +d[10]
}

/**
 * UX-9 #3: validação dígito verificador CNPJ (14 dígitos)
 */
export function isValidCNPJ(d: string): boolean {
  if (!/^\d{14}$/.test(d)) return false
  if (/^(\d)\1+$/.test(d)) return false
  const calc = (slice: string, weights: number[]) => {
    const sum = slice.split('').reduce((s, c, i) => s + +c * weights[i], 0)
    const r = sum % 11
    return r < 2 ? 0 : 11 - r
  }
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const dv1 = calc(d.slice(0, 12), w1)
  if (dv1 !== +d[12]) return false
  const dv2 = calc(d.slice(0, 13), w2)
  return dv2 === +d[13]
}

/**
 * UX-9 #3: validação combinada — aceita CPF (11d) ou CNPJ (14d).
 * Permite vazio (campo opcional).
 */
export function isValidDocument(raw?: string | null): boolean {
  if (!raw) return true  // opcional
  const d = normalizeDocument(raw)
  if (d.length === 11) return isValidCPF(d)
  if (d.length === 14) return isValidCNPJ(d)
  return false
}

/**
 * UX-10 #10: validação telefone — antes aceitava "9", "abc", qualquer string
 * <= 20 chars. Agora extrai digits + valida 10 (fixo DDD+8) ou 11 (cel DDD+9).
 */
const PHONE_REGEX = /^\d{10,11}$/
const phoneField = (label: string) =>
  z.string()
    .max(20)
    .transform(v => v ? v.replace(/\D/g, '') : v)
    .refine(v => !v || PHONE_REGEX.test(v), {
      message: `${label} deve ter 10 ou 11 dígitos (DDD + número)`,
    })
    .optional()
    .nullable()

/**
 * Schema para criação de cliente
 */
export const createCustomerSchema = z.object({
  legal_name: z.string().min(1).max(255),
  trade_name: z.string().max(255).optional(),
  person_type: z.enum(['FISICA', 'JURIDICA']).default('FISICA'),
  customer_type: z.enum(['CLIENTE', 'FORNECEDOR', 'AMBOS']).default('CLIENTE'),
  document_number: z.string().max(20).optional()
    .transform(v => v ? normalizeDocument(v) : v)
    .refine(v => !v || isValidDocument(v), { message: 'CPF/CNPJ inválido' }),
  email: z.string().email().max(255).optional().nullable(),
  phone: phoneField('Telefone'),
  mobile: phoneField('Celular'),
  address_street: z.string().max(255).optional().nullable(),
  address_number: z.string().max(20).optional().nullable(),
  address_complement: z.string().max(255).optional().nullable(),
  address_neighborhood: z.string().max(100).optional().nullable(),
  address_city: z.string().max(100).optional().nullable(),
  address_state: z.string().max(2).optional().nullable(),
  address_zip: z.string().max(10).optional().nullable(),
  state_registration: z.string().max(30).optional().nullable(),
  city_registration: z.string().max(30).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
})

/**
 * Schema para atualização de cliente (PUT)
 * Nunca permite alterar company_id, created_at, deleted_at
 */
export const updateCustomerSchema = z.object({
  legal_name: z.string().min(1).max(255).optional(),
  trade_name: z.string().max(255).nullable().optional(),
  person_type: z.enum(['FISICA', 'JURIDICA']).optional(),
  customer_type: z.enum(['CLIENTE', 'FORNECEDOR', 'AMBOS']).optional(),
  document_number: z.string().max(20).optional()
    .transform(v => v ? normalizeDocument(v) : v)
    .refine(v => !v || isValidDocument(v), { message: 'CPF/CNPJ inválido' }),
  email: z.string().email().max(255).nullable().optional(),
  phone: phoneField('Telefone'),
  mobile: phoneField('Celular'),
  address_street: z.string().max(255).nullable().optional(),
  address_number: z.string().max(20).nullable().optional(),
  address_complement: z.string().max(255).nullable().optional(),
  address_neighborhood: z.string().max(100).nullable().optional(),
  address_city: z.string().max(100).nullable().optional(),
  address_state: z.string().max(2).nullable().optional(),
  address_zip: z.string().max(10).nullable().optional(),
  state_registration: z.string().max(30).nullable().optional(),
  city_registration: z.string().max(30).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
}).strict()
