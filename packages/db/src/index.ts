import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
})

// ========== TEXT FORMATTING MIDDLEWARE ==========
// Auto-formats text fields on every create/update across the entire ERP.
// Rules:
// - Names, addresses, equipment → UPPERCASE (ERP standard)
// - Email → lowercase
// - Phone/mobile → digits only
// - Descriptions → capitalize first letter of sentences
// - Trims all strings, removes double spaces

const UPPERCASE_FIELDS = [
  'legal_name', 'trade_name',
  'address_street', 'address_number', 'address_complement',
  'address_neighborhood', 'address_city',
  'equipment_type', 'equipment_brand', 'equipment_model',
  'serial_number', 'reference',
]

const STATE_FIELDS = ['address_state']
const EMAIL_FIELDS = ['email']
const PHONE_FIELDS = ['phone', 'mobile']
const DIGITS_ONLY_FIELDS = ['document_number', 'address_zip', 'state_registration', 'city_registration']
const SENTENCE_FIELDS = ['reported_issue', 'diagnosis', 'reception_notes', 'internal_notes', 'description', 'subject', 'message']

function formatFieldValue(fieldName: string, value: unknown): unknown {
  if (typeof value !== 'string' || !value) return value

  const cleaned = value.trim().replace(/\s+/g, ' ')
  if (!cleaned) return cleaned

  if (UPPERCASE_FIELDS.includes(fieldName)) {
    return cleaned.toUpperCase()
  }
  if (STATE_FIELDS.includes(fieldName)) {
    return cleaned.toUpperCase().slice(0, 2)
  }
  if (EMAIL_FIELDS.includes(fieldName)) {
    return cleaned.toLowerCase()
  }
  if (PHONE_FIELDS.includes(fieldName)) {
    return cleaned.replace(/\D/g, '')
  }
  if (DIGITS_ONLY_FIELDS.includes(fieldName)) {
    return cleaned.replace(/\D/g, '')
  }
  if (SENTENCE_FIELDS.includes(fieldName)) {
    // Capitalize first letter of the text and after . ! ?
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
  }

  return cleaned
}

function formatDataObject(data: Record<string, unknown>): Record<string, unknown> {
  const result = { ...data }
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'string') {
      result[key] = formatFieldValue(key, value)
    }
  }
  return result
}

prisma.$use(async (params, next) => {
  if (params.action === 'create' || params.action === 'update' || params.action === 'upsert') {
    if (params.args?.data && typeof params.args.data === 'object') {
      params.args.data = formatDataObject(params.args.data as Record<string, unknown>)
    }
    // For upsert, also format the create and update objects
    if (params.action === 'upsert') {
      if (params.args?.create && typeof params.args.create === 'object') {
        params.args.create = formatDataObject(params.args.create as Record<string, unknown>)
      }
      if (params.args?.update && typeof params.args.update === 'object') {
        params.args.update = formatDataObject(params.args.update as Record<string, unknown>)
      }
    }
    // For createMany
    if (params.action === 'create' && params.args?.data && Array.isArray(params.args.data)) {
      params.args.data = params.args.data.map((item: Record<string, unknown>) =>
        typeof item === 'object' ? formatDataObject(item) : item
      )
    }
  }
  return next(params)
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export { PrismaClient }
export * from '@prisma/client'
