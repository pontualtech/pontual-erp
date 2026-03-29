import { z } from 'zod'

/**
 * Schema para criação de OS
 */
export const createOSSchema = z.object({
  customer_id: z.string().uuid(),
  technician_id: z.string().uuid().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  os_type: z.enum(['BALCAO', 'COLETA', 'REMOTO', 'CAMPO']).default('BALCAO'),
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
export const updateOSSchema = z.object({
  equipment_type: z.string().max(255).optional(),
  equipment_brand: z.string().max(255).optional(),
  equipment_model: z.string().max(255).optional(),
  equipment_serial: z.string().max(255).optional(),
  serial_number: z.string().max(255).optional(),
  reported_issue: z.string().max(5000).optional(),
  diagnosis: z.string().max(5000).optional(),
  solution: z.string().max(5000).optional(),
  internal_notes: z.string().max(5000).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  technician_id: z.string().uuid().nullable().optional(),
  estimated_value: z.number().int().nonnegative().nullable().optional(),
  estimated_cost: z.number().int().nonnegative().nullable().optional(),
  estimated_delivery: z.string().datetime().nullable().optional(),
  warranty_until: z.string().datetime().nullable().optional(),
  custom_data: z.record(z.unknown()).nullable().optional().refine(
    (v) => !v || JSON.stringify(v).length < 10000,
    { message: 'custom_data excede o limite de 10KB' }
  ),
  reception_notes: z.string().max(5000).optional(),
  os_type: z.enum(['BALCAO', 'COLETA', 'REMOTO', 'CAMPO']).optional(),
  customer_id: z.string().uuid().optional(),
}).strict()
