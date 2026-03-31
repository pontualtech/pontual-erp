import { z } from 'zod'

/**
 * Schema para criação de OS
 */
export const createOSSchema = z.object({
  customer_id: z.string().uuid(),
  technician_id: z.string().uuid().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  os_type: z.enum(['BALCAO', 'COLETA', 'REMOTO', 'CAMPO', 'ENTREGA']).default('BALCAO'),
  equipment_type: z.string().max(255).optional(),
  equipment_brand: z.string().max(255).optional(),
  equipment_model: z.string().max(255).optional(),
  serial_number: z.string().max(255).optional(),
  reported_issue: z.string().max(5000).optional(),
  reception_notes: z.string().max(5000).optional(),
  internal_notes: z.string().max(5000).optional(),
  estimated_cost: z.number().int().nonnegative().optional(),
  estimated_delivery: z.string().datetime().optional(),
})

/**
 * Schema para atualização de OS (PUT)
 * Campos sensíveis como company_id, os_number, status_id, vhsys_id NÃO são permitidos
 */
// Aceita data ISO completa ou apenas YYYY-MM-DD, converte para ISO
const dateString = z.string().nullable().optional().transform((v) => {
  if (!v) return v
  // Se é só data (YYYY-MM-DD), adiciona horário
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v}T00:00:00.000Z`
  return v
})

export const updateOSSchema = z.object({
  equipment_type: z.string().max(255).nullable().optional(),
  equipment_brand: z.string().max(255).nullable().optional(),
  equipment_model: z.string().max(255).nullable().optional(),
  equipment_serial: z.string().max(255).nullable().optional(),
  serial_number: z.string().max(255).nullable().optional(),
  reference: z.string().max(500).nullable().optional(),
  reported_issue: z.string().max(5000).nullable().optional(),
  diagnosis: z.string().max(5000).nullable().optional(),
  solution: z.string().max(5000).nullable().optional(),
  internal_notes: z.string().max(5000).nullable().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  technician_id: z.string().uuid().nullable().optional(),
  estimated_value: z.number().int().nonnegative().nullable().optional(),
  estimated_cost: z.number().int().nonnegative().nullable().optional(),
  total_cost: z.number().int().nonnegative().nullable().optional(),
  approved_cost: z.number().int().nonnegative().nullable().optional(),
  total_parts: z.number().int().nonnegative().nullable().optional(),
  total_services: z.number().int().nonnegative().nullable().optional(),
  estimated_delivery: dateString,
  actual_delivery: dateString,
  warranty_until: dateString,
  custom_data: z.record(z.unknown()).nullable().optional().refine(
    (v) => !v || JSON.stringify(v).length < 10000,
    { message: 'custom_data excede o limite de 10KB' }
  ),
  reception_notes: z.string().max(5000).nullable().optional(),
  payment_method: z.string().max(255).nullable().optional(),
  os_type: z.enum(['BALCAO', 'COLETA', 'REMOTO', 'CAMPO', 'ENTREGA']).optional(),
  customer_id: z.string().uuid().optional(),
}).strict()
