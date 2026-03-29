import { z } from 'zod'

/**
 * Normaliza documento removendo formatação
 */
export function normalizeDocument(doc: string): string {
  return doc.replace(/[.\-\/\s]/g, '')
}

/**
 * Schema para criação de cliente
 */
export const createCustomerSchema = z.object({
  legal_name: z.string().min(1).max(255),
  trade_name: z.string().max(255).optional(),
  person_type: z.enum(['FISICA', 'JURIDICA']).default('FISICA'),
  customer_type: z.enum(['CLIENTE', 'FORNECEDOR', 'AMBOS']).default('CLIENTE'),
  document_number: z.string().max(20).optional().transform(v => v ? normalizeDocument(v) : v),
  email: z.string().email().max(255).optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
  mobile: z.string().max(20).optional().nullable(),
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
  document_number: z.string().max(20).optional().transform(v => v ? normalizeDocument(v) : v),
  email: z.string().email().max(255).nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  mobile: z.string().max(20).nullable().optional(),
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
