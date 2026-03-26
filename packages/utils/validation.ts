import { z } from 'zod'

// ═══════════════════════════════════════════════════════════════
// PontualERP — Unified Zod Validation Schemas
// ═══════════════════════════════════════════════════════════════

// ─── Shared Primitives ──────────────────────────────────────

const amountCents = z.number().int().min(1, 'Valor deve ser maior que zero')
const dateString = z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
const cuidString = z.string().min(20).max(30)

// ═══════════════ PAGINATION ═══════════════

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
})
export type PaginationInput = z.infer<typeof paginationSchema>

export const idParamSchema = z.object({
  id: z.string().min(1),
})

export const moduleFilterSchema = z.object({
  module: z.string().min(1).max(50),
})

// ═══════════════ CORE — AUTH ═══════════════

export const registerSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(72),
  companyName: z.string().min(2).max(100),
  companySlug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug deve conter apenas letras minusculas, numeros e hifens'),
  phone: z.string().optional(),
})
export type RegisterInput = z.infer<typeof registerSchema>

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})
export type LoginInput = z.infer<typeof loginSchema>

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
})

export const resetPasswordSchema = z.object({
  password: z.string().min(8, 'Senha deve ter no minimo 8 caracteres'),
})

export const switchCompanySchema = z.object({
  companyId: z.string().min(1),
})

// ═══════════════ CORE — USERS ═══════════════

export const createUserSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  phone: z.string().optional(),
  roleId: z.string().min(1),
  password: z.string().min(8).max(72).optional(),
})
export type CreateUserInput = z.infer<typeof createUserSchema>

export const updateUserSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  preferences: z.record(z.unknown()).optional(),
})
export type UpdateUserInput = z.infer<typeof updateUserSchema>

export const assignRoleSchema = z.object({
  roleId: z.string().min(1),
})

// ═══════════════ CORE — ROLES & PERMISSIONS ═══════════════

export const createRoleSchema = z.object({
  name: z.string().min(2).max(50),
  description: z.string().max(200).optional(),
})
export type CreateRoleInput = z.infer<typeof createRoleSchema>

export const updateRoleSchema = createRoleSchema.partial()

export const setPermissionsSchema = z.object({
  permissions: z.array(
    z.object({
      permissionId: z.string().min(1),
      granted: z.boolean(),
    })
  ),
})

// ═══════════════ CORE — CUSTOM FIELDS ═══════════════

export const fieldTypeEnum = z.enum([
  'text',
  'number',
  'date',
  'select',
  'multiselect',
  'boolean',
  'url',
])

export const createCustomFieldSchema = z.object({
  module: z.string().min(1).max(50),
  fieldName: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z_][a-z0-9_]*$/, 'Nome deve usar snake_case'),
  fieldLabel: z.string().min(1).max(100),
  fieldType: fieldTypeEnum,
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
  defaultValue: z.string().optional(),
  order: z.number().int().min(0).optional(),
})
export type CreateCustomFieldInput = z.infer<typeof createCustomFieldSchema>

export const updateCustomFieldSchema = createCustomFieldSchema
  .partial()
  .omit({ module: true, fieldName: true })

export const reorderItemsSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().min(1),
      order: z.number().int().min(0),
    })
  ),
})

// ═══════════════ CORE — FIELD LABELS ═══════════════

export const upsertFieldLabelsSchema = z.object({
  module: z.string().min(1),
  labels: z.array(
    z.object({
      fieldKey: z.string().min(1),
      customLabel: z.string().min(1).max(100),
    })
  ),
})

// ═══════════════ CORE — MODULE STATUSES ═══════════════

export const createModuleStatusSchema = z.object({
  module: z.string().min(1).max(50),
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  icon: z.string().optional(),
  isFinal: z.boolean().default(false),
  isDefault: z.boolean().default(false),
  transitions: z.array(z.string()).default([]),
  order: z.number().int().min(0).optional(),
})
export type CreateModuleStatusInput = z.infer<typeof createModuleStatusSchema>

export const updateModuleStatusSchema = createModuleStatusSchema.partial()

// ═══════════════ CORE — PRINT TEMPLATES ═══════════════

export const printTemplateTypeEnum = z.enum(['os', 'quote', 'receipt', 'invoice', 'label'])

export const createPrintTemplateSchema = z.object({
  type: printTemplateTypeEnum,
  name: z.string().min(1).max(100),
  htmlTemplate: z.string().min(1),
  cssOverride: z.string().optional(),
  isDefault: z.boolean().default(false),
})
export type CreatePrintTemplateInput = z.infer<typeof createPrintTemplateSchema>

export const updatePrintTemplateSchema = createPrintTemplateSchema.partial()

// ═══════════════ CORE — MESSAGE TEMPLATES ═══════════════

export const messageTriggerEnum = z.enum([
  'os_created',
  'os_approved',
  'os_ready',
  'os_delivered',
  'quote_sent',
  'quote_approved',
  'payment_received',
  'payment_overdue',
])

export const messageChannelEnum = z.enum(['whatsapp', 'email', 'sms'])

export const createMessageTemplateSchema = z.object({
  trigger: messageTriggerEnum,
  channel: messageChannelEnum,
  name: z.string().min(1).max(100),
  subject: z.string().max(200).optional(),
  template: z.string().min(1),
  isActive: z.boolean().default(true),
})
export type CreateMessageTemplateInput = z.infer<typeof createMessageTemplateSchema>

export const updateMessageTemplateSchema = createMessageTemplateSchema.partial()

// ═══════════════ CORE — CATEGORIES ═══════════════

export const createCategorySchema = z.object({
  module: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  parentId: z.string().nullable().optional(),
  order: z.number().int().min(0).optional(),
})
export type CreateCategoryInput = z.infer<typeof createCategorySchema>

export const updateCategorySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  parentId: z.string().nullable().optional(),
  order: z.number().int().min(0).optional(),
})

// ═══════════════ CORE — SETTINGS ═══════════════

export const settingTypeEnum = z.enum(['string', 'number', 'boolean', 'json'])

export const upsertSettingsSchema = z.object({
  settings: z.array(
    z.object({
      key: z.string().min(1).max(100),
      value: z.string(),
      type: settingTypeEnum.default('string'),
      group: z.string().default('general'),
    })
  ),
})
export type UpsertSettingsInput = z.infer<typeof upsertSettingsSchema>

export const upsertSingleSettingSchema = z.object({
  value: z.string(),
  type: settingTypeEnum.default('string'),
  group: z.string().default('general'),
})

// ═══════════════ CORE — DASHBOARD ═══════════════

export const saveWidgetsSchema = z.object({
  widgets: z.array(
    z.object({
      widgetKey: z.string().min(1),
      title: z.string().min(1),
      type: z.enum(['counter', 'chart', 'list', 'calendar']),
      config: z.record(z.unknown()).default({}),
      position: z.object({
        x: z.number().int().min(0),
        y: z.number().int().min(0),
        w: z.number().int().min(1).max(12),
        h: z.number().int().min(1).max(8),
      }),
      isVisible: z.boolean().default(true),
    })
  ),
})

// ═══════════════ CORE — AUDIT LOG ═══════════════

export const auditLogFilterSchema = paginationSchema.extend({
  module: z.string().optional(),
  action: z.string().optional(),
  userId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

// ═══════════════ CORE — API KEYS ═══════════════

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  permissions: z.array(z.string()).default([]),
  rateLimit: z.number().int().min(1).max(10000).default(100),
  expiresAt: z.coerce.date().optional(),
})
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>

// ═══════════════ CORE — WEBHOOKS ═══════════════

export const createWebhookSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  events: z.array(z.string()).min(1),
  secret: z.string().optional(),
  isActive: z.boolean().default(true),
})
export type CreateWebhookInput = z.infer<typeof createWebhookSchema>

// ═══════════════ OS + CLIENTES ═══════════════

// ─── Address (shared) ───────────────────────────────────────

const addressSchema = z.object({
  street: z.string().max(255).optional().nullable(),
  number: z.string().max(20).optional().nullable(),
  complement: z.string().max(100).optional().nullable(),
  neighborhood: z.string().max(100).optional().nullable(),
  zip: z.string().regex(/^\d{5}-?\d{3}$/).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().length(2).optional().nullable(),
})

// ─── Customers ──────────────────────────────────────────────

export const createCustomerSchema = z.object({
  personType: z.enum(['PF', 'PJ']),
  customerType: z.enum(['CLIENTE', 'FORNECEDOR', 'AMBOS']).default('CLIENTE'),
  legalName: z.string().min(2).max(255),
  tradeName: z.string().max(255).optional().nullable(),
  documentNumber: z.string().min(11).max(18),
  documentCpf: z.string().optional().nullable(),
  documentCnpj: z.string().optional().nullable(),
  stateRegistration: z.string().max(20).optional().nullable(),
  municipalRegistration: z.string().max(20).optional().nullable(),
  address: addressSchema.optional(),
  billingAddress: addressSchema.optional(),
  contactName: z.string().max(150).optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
  phoneSecondary: z.string().max(20).optional().nullable(),
  mobile: z.string().max(20).optional().nullable(),
  email: z.string().email().optional().nullable(),
  emailSecondary: z.string().email().optional().nullable(),
  notes: z.string().optional().nullable(),
  tags: z.array(z.string()).default([]),
  customFields: z.record(z.unknown()).default({}),
})
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>

export const updateCustomerSchema = createCustomerSchema.partial()

export const searchCustomerSchema = z.object({
  q: z.string().optional(),
  personType: z.enum(['PF', 'PJ']).optional(),
  customerType: z.enum(['CLIENTE', 'FORNECEDOR', 'AMBOS']).optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  sortBy: z.string().default('legalName'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
})

// ─── Service Orders ─────────────────────────────────────────

export const createServiceOrderSchema = z.object({
  customerId: z.string().cuid(),
  priority: z.enum(['BAIXA', 'NORMAL', 'ALTA', 'URGENTE']).default('NORMAL'),
  osType: z.enum(['BALCAO', 'COLETA', 'ENTREGA', 'COLETA_ENTREGA']).default('BALCAO'),
  assignedTo: z.string().cuid().optional().nullable(),
  equipment: z.string().max(255).optional().nullable(),
  equipmentType: z.string().max(100).optional().nullable(),
  equipmentBrand: z.string().max(100).optional().nullable(),
  equipmentModel: z.string().max(100).optional().nullable(),
  equipmentSerial: z.string().max(100).optional().nullable(),
  pageCountIn: z.number().int().min(0).optional().nullable(),
  reportedIssue: z.string().optional().nullable(),
  receptionNotes: z.string().optional().nullable(),
  internalNotes: z.string().optional().nullable(),
  referenceCode: z.string().max(100).optional().nullable(),
  estimatedDelivery: z.coerce.date().optional().nullable(),
  collectionAddress: z.string().optional().nullable(),
  deliveryAddress: z.string().optional().nullable(),
  customFields: z.record(z.unknown()).default({}),
})
export type CreateServiceOrderInput = z.infer<typeof createServiceOrderSchema>

export const updateServiceOrderSchema = createServiceOrderSchema.partial()

export const transitionStatusSchema = z.object({
  toStatusId: z.string().cuid(),
  notes: z.string().optional(),
})

export const searchServiceOrderSchema = z.object({
  q: z.string().optional(),
  statusId: z.array(z.string()).optional(),
  assignedTo: z.array(z.string()).optional(),
  priority: z.array(z.enum(['BAIXA', 'NORMAL', 'ALTA', 'URGENTE'])).optional(),
  osType: z.enum(['BALCAO', 'COLETA', 'ENTREGA', 'COLETA_ENTREGA']).optional(),
  customerId: z.string().optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  deliveryFrom: z.coerce.date().optional(),
  deliveryTo: z.coerce.date().optional(),
  isOverdue: z.coerce.boolean().optional(),
  isWarranty: z.coerce.boolean().optional(),
  equipmentType: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  sortBy: z.string().default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
})

// ─── OS Items ───────────────────────────────────────────────

export const createOSItemSchema = z.object({
  itemType: z.enum(['PECA', 'SERVICO', 'MAO_DE_OBRA']),
  productId: z.string().cuid().optional().nullable(),
  description: z.string().min(1).max(255),
  quantity: z.number().positive(),
  unitPrice: z.number().int().min(0),
  discount: z.number().int().min(0).default(0),
})
export type CreateOSItemInput = z.infer<typeof createOSItemSchema>

// ─── Quotes (Orcamentos) ────────────────────────────────────

export const createQuoteSchema = z.object({
  serviceOrderId: z.string().cuid(),
  validUntil: z.coerce.date().optional().nullable(),
  executionDays: z.number().int().positive().optional().nullable(),
  warrantyDays: z.number().int().min(0).optional().nullable(),
  notes: z.string().optional().nullable(),
  termsAndConditions: z.string().optional().nullable(),
  items: z.array(createOSItemSchema).min(1),
})
export type CreateQuoteInput = z.infer<typeof createQuoteSchema>

export const updateQuoteSchema = z.object({
  validUntil: z.coerce.date().optional().nullable(),
  executionDays: z.number().int().positive().optional().nullable(),
  warrantyDays: z.number().int().min(0).optional().nullable(),
  notes: z.string().optional().nullable(),
  termsAndConditions: z.string().optional().nullable(),
  items: z.array(createOSItemSchema).min(1).optional(),
})

export const sendQuoteSchema = z.object({
  via: z.enum(['whatsapp', 'email', 'link']),
})

export const publicQuoteResponseSchema = z.object({
  action: z.enum(['approve', 'reject']),
  rejectionReason: z.string().optional(),
})

// ─── OS Upload ──────────────────────────────────────────────

export const osUploadSchema = z.object({
  stage: z.enum(['RECEPCAO', 'DIAGNOSTICO', 'EXECUCAO', 'ENTREGA']).default('RECEPCAO'),
  caption: z.string().optional(),
})

// ─── Quote List Filter ──────────────────────────────────────

export const quoteListFilterSchema = z.object({
  status: z.enum(['RASCUNHO', 'ENVIADO', 'APROVADO', 'RECUSADO', 'EXPIRADO']).optional(),
  serviceOrderId: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
})

// ─── Webhook Quote Response ─────────────────────────────────

export const webhookQuoteSchema = z.object({
  approvalToken: z.string(),
  action: z.enum(['approve', 'reject']),
  reason: z.string().optional(),
  source: z.string().default('whatsapp'),
})

// ═══════════════ ESTOQUE + PRODUTOS ═══════════════

// ─── Products ───────────────────────────────────────────────

export const productCreateSchema = z.object({
  name: z.string().min(1, 'Nome obrigatorio').max(255),
  description: z.string().max(5000).optional(),
  barcode: z.string().max(50).optional(),
  internalCode: z.string().max(50).optional(),
  categoryId: z.string().cuid().optional(),
  brand: z.string().max(100).optional(),
  unit: z.string().max(10).default('UN'),
  costPrice: z.number().int().min(0).default(0),
  salePrice: z.number().int().min(0).default(0),
  markupPercent: z.number().min(0).max(99999).optional(),
  ncm: z.string().regex(/^\d{8}$/, 'NCM deve ter 8 digitos').optional(),
  cfop: z.string().regex(/^\d{4}$/, 'CFOP deve ter 4 digitos').optional(),
  cst: z.string().max(10).optional(),
  origin: z.string().max(2).optional(),
  weight: z.number().min(0).optional(),
  width: z.number().min(0).optional(),
  height: z.number().min(0).optional(),
  depth: z.number().min(0).optional(),
  photoUrl: z.string().url().optional(),
  photos: z.array(z.string().url()).max(10).optional(),
  technicalSheet: z.string().max(10000).optional(),
  minStock: z.number().min(0).optional(),
  maxStock: z.number().min(0).optional(),
  expiresAt: z.string().datetime().optional(),
  locationName: z.string().max(100).optional(),
  isActive: z.boolean().default(true),
  tags: z.array(z.string().max(50)).max(20).optional(),
  customFields: z.record(z.unknown()).optional(),
})
export type ProductCreateInput = z.infer<typeof productCreateSchema>

export const productUpdateSchema = productCreateSchema.partial()

export const productSearchParamsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().max(200).optional(),
  categoryId: z.string().cuid().optional(),
  brand: z.string().max(100).optional(),
  isActive: z.enum(['true', 'false']).optional(),
  belowMin: z.enum(['true', 'false']).optional(),
  sortBy: z.enum(['name', 'createdAt', 'salePrice', 'costPrice', 'currentStock']).default('name'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
})

export const productBulkUpdateSchema = z.object({
  ids: z.array(z.string().cuid()).min(1).max(100),
  data: z.object({
    categoryId: z.string().cuid().optional(),
    brand: z.string().max(100).optional(),
    isActive: z.boolean().optional(),
    costPrice: z.number().int().min(0).optional(),
    salePrice: z.number().int().min(0).optional(),
  }),
})

export const productImportSchema = z.object({
  products: z.array(productCreateSchema).min(1).max(500),
})

export const barcodeLookupSchema = z.object({
  barcode: z.string().min(1).max(50),
})

// ─── Product Categories (Estoque) ───────────────────────────

export const productCategoryCreateSchema = z.object({
  name: z.string().min(1).max(100),
  parentId: z.string().cuid().optional(),
  color: z.string().max(20).optional(),
  icon: z.string().max(50).optional(),
})

// ─── Stock Movements ────────────────────────────────────────

export const stockMovementCreateSchema = z.object({
  productId: z.string().cuid(),
  type: z.enum(['ENTRY', 'EXIT']),
  reason: z.enum(['MANUAL_ENTRY', 'MANUAL_EXIT', 'RETURN_CUSTOMER', 'RETURN_SUPPLIER']),
  quantity: z.number().positive('Quantidade deve ser maior que zero'),
  notes: z.string().max(500).optional(),
})
export type StockMovementCreateInput = z.infer<typeof stockMovementCreateSchema>

export const stockAdjustSchema = z.object({
  productId: z.string().cuid(),
  newStock: z.number().min(0, 'Estoque nao pode ser negativo'),
  notes: z.string().max(500).optional(),
})

export const movementHistoryParamsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  type: z.enum(['ENTRY', 'EXIT', 'ADJUSTMENT']).optional(),
  reason: z.enum([
    'PURCHASE', 'SALE', 'OS_RESERVE', 'OS_DEDUCT', 'OS_RELEASE',
    'MANUAL_ENTRY', 'MANUAL_EXIT', 'ADJUSTMENT',
    'RETURN_SUPPLIER', 'RETURN_CUSTOMER', 'INITIAL',
  ]).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
})

// ─── Purchase Entries ───────────────────────────────────────

export const purchaseEntryCreateSchema = z.object({
  supplierId: z.string().cuid(),
  invoiceNumber: z.string().max(50).optional(),
  invoiceKey: z.string().regex(/^\d{44}$/, 'Chave NF-e deve ter 44 digitos').optional(),
  orderedAt: z.string().datetime().optional(),
  expectedAt: z.string().datetime().optional(),
  shippingCost: z.number().int().min(0).default(0),
  otherCosts: z.number().int().min(0).default(0),
  totalDiscount: z.number().int().min(0).default(0),
  notes: z.string().max(2000).optional(),
  items: z.array(z.object({
    productId: z.string().cuid(),
    quantity: z.number().positive(),
    unitCost: z.number().int().min(0),
    discount: z.number().int().min(0).default(0),
  })).min(1, 'Pelo menos um item obrigatorio'),
})
export type PurchaseEntryCreateInput = z.infer<typeof purchaseEntryCreateSchema>

export const purchaseEntryUpdateSchema = z.object({
  supplierId: z.string().cuid().optional(),
  invoiceNumber: z.string().max(50).optional(),
  invoiceKey: z.string().regex(/^\d{44}$/).optional(),
  orderedAt: z.string().datetime().optional(),
  expectedAt: z.string().datetime().optional(),
  shippingCost: z.number().int().min(0).optional(),
  otherCosts: z.number().int().min(0).optional(),
  totalDiscount: z.number().int().min(0).optional(),
  notes: z.string().max(2000).optional(),
  status: z.enum(['PENDENTE']).optional(),
})

export const purchaseEntryItemCreateSchema = z.object({
  productId: z.string().cuid(),
  quantity: z.number().positive(),
  unitCost: z.number().int().min(0),
  discount: z.number().int().min(0).default(0),
})

export const purchaseEntryItemUpdateSchema = z.object({
  quantity: z.number().positive().optional(),
  unitCost: z.number().int().min(0).optional(),
  discount: z.number().int().min(0).optional(),
})

export const purchaseEntryListParamsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['RASCUNHO', 'PENDENTE', 'RECEBIDA', 'CANCELADA']).optional(),
  supplierId: z.string().cuid().optional(),
})

// ─── Stock Alerts ───────────────────────────────────────────

export const stockAlertsParamsSchema = z.object({
  status: z.enum(['PENDING', 'ACKNOWLEDGED', 'RESOLVED']).optional(),
  type: z.enum(['BELOW_MIN', 'ABOVE_MAX', 'EXPIRING', 'OUT_OF_STOCK']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

export const alertAcknowledgeSchema = z.object({
  id: z.string().cuid(),
})

export const expiringProductsParamsSchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
})

// ─── Product Search (quick) ─────────────────────────────────

export const productQuickSearchSchema = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(10),
})

// ═══════════════ FINANCEIRO ═══════════════

// ─── Enums ──────────────────────────────────────────────────

export const paymentMethodEnum = z.enum([
  'DINHEIRO', 'PIX', 'BOLETO', 'TRANSFERENCIA',
  'CARTAO_CREDITO', 'CARTAO_DEBITO', 'CHEQUE',
  'LINK_PAGAMENTO', 'OUTROS',
])

export const recurrenceEnum = z.enum([
  'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY',
  'QUARTERLY', 'SEMIANNUAL', 'YEARLY',
])

// ─── Accounts ───────────────────────────────────────────────

export const createAccountSchema = z.object({
  name: z.string().min(2).max(100),
  type: z.enum(['CHECKING', 'SAVINGS', 'CASH', 'PAYMENT', 'CREDIT_CARD', 'INVESTMENT']),
  bankCode: z.string().max(10).optional(),
  bankName: z.string().max(100).optional(),
  agency: z.string().max(10).optional(),
  agencyDigit: z.string().max(2).optional(),
  accountNumber: z.string().max(20).optional(),
  accountDigit: z.string().max(2).optional(),
  pixKey: z.string().max(100).optional(),
  pixKeyType: z.enum(['CPF', 'CNPJ', 'EMAIL', 'TELEFONE', 'EVP']).optional(),
  initialBalance: z.number().int().default(0),
  isDefault: z.boolean().default(false),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  provider: z.enum(['inter', 'itau', 'bb', 'manual']).optional(),
  isApiEnabled: z.boolean().default(false),
})
export type CreateAccountInput = z.infer<typeof createAccountSchema>

export const updateAccountSchema = createAccountSchema.partial()

// ─── Cost Centers ───────────────────────────────────────────

export const createCostCenterSchema = z.object({
  name: z.string().min(2).max(100),
  code: z.string().max(20).optional(),
  parentId: cuidString.optional(),
  isActive: z.boolean().default(true),
})
export type CreateCostCenterInput = z.infer<typeof createCostCenterSchema>

export const updateCostCenterSchema = createCostCenterSchema.partial()

// ─── Accounts Payable ───────────────────────────────────────

export const createPayableSchema = z.object({
  supplierId: cuidString.optional(),
  supplierName: z.string().max(200).optional(),
  description: z.string().min(3).max(500),
  documentNumber: z.string().max(50).optional(),
  notes: z.string().max(2000).optional(),
  amount: amountCents,
  dueDate: dateString,
  categoryId: cuidString.optional(),
  costCenterId: cuidString.optional(),
  paymentMethod: paymentMethodEnum.optional(),
  accountId: cuidString.optional(),
  installments: z.number().int().min(1).max(120).default(1),
  recurrence: recurrenceEnum.optional(),
  recurrenceEndDate: dateString.optional(),
  customFields: z.record(z.unknown()).default({}),
  tags: z.array(z.string()).default([]),
})
export type CreatePayableInput = z.infer<typeof createPayableSchema>

export const updatePayableSchema = createPayableSchema.partial()

export const payableFiltersSchema = z.object({
  status: z.enum(['ABERTA', 'PARCIAL', 'PAGA', 'VENCIDA', 'CANCELADA']).optional(),
  supplierId: cuidString.optional(),
  categoryId: cuidString.optional(),
  costCenterId: cuidString.optional(),
  dueDateFrom: dateString.optional(),
  dueDateTo: dateString.optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sortBy: z.enum(['dueDate', 'amount', 'status', 'createdAt']).default('dueDate'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
})

// ─── Accounts Receivable ────────────────────────────────────

export const createReceivableSchema = z.object({
  customerId: cuidString.optional(),
  customerName: z.string().max(200).optional(),
  serviceOrderId: cuidString.optional(),
  description: z.string().min(3).max(500),
  documentNumber: z.string().max(50).optional(),
  notes: z.string().max(2000).optional(),
  amount: amountCents,
  dueDate: dateString,
  categoryId: cuidString.optional(),
  costCenterId: cuidString.optional(),
  paymentMethod: paymentMethodEnum.optional(),
  accountId: cuidString.optional(),
  installments: z.number().int().min(1).max(120).default(1),
  generateBoleto: z.boolean().default(false),
  generatePix: z.boolean().default(false),
  customFields: z.record(z.unknown()).default({}),
  tags: z.array(z.string()).default([]),
})
export type CreateReceivableInput = z.infer<typeof createReceivableSchema>

export const updateReceivableSchema = createReceivableSchema.partial()

export const receivableFiltersSchema = z.object({
  status: z.enum(['ABERTA', 'PARCIAL', 'RECEBIDA', 'VENCIDA', 'CANCELADA']).optional(),
  customerId: cuidString.optional(),
  serviceOrderId: cuidString.optional(),
  categoryId: cuidString.optional(),
  dueDateFrom: dateString.optional(),
  dueDateTo: dateString.optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sortBy: z.enum(['dueDate', 'amount', 'status', 'createdAt']).default('dueDate'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
})

// ─── Card Sales Filter ──────────────────────────────────────

export const cardSaleFiltersSchema = z.object({
  brand: z.enum(['VISA', 'MASTERCARD', 'ELO', 'AMEX', 'HIPERCARD', 'DINERS', 'DISCOVER', 'OUTROS']).optional(),
  transactionType: z.enum(['CREDITO', 'DEBITO', 'VOUCHER']).optional(),
  status: z.enum(['PENDENTE', 'LIQUIDADA', 'CANCELADA', 'CHARGEBACK', 'ANTECIPADA']).optional(),
  dateFrom: dateString.optional(),
  dateTo: dateString.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

// ─── Payment Registration ───────────────────────────────────

export const registerPaymentSchema = z.object({
  installmentIds: z.array(cuidString).min(1),
  paidAmount: amountCents,
  paidAt: dateString.optional(),
  paymentMethod: paymentMethodEnum,
  accountId: cuidString.optional(),
  notes: z.string().max(500).optional(),
})

// ─── Cash Flow ──────────────────────────────────────────────

export const cashFlowQuerySchema = z.object({
  startDate: dateString,
  endDate: dateString,
  groupBy: z.enum(['day', 'week', 'month']).default('day'),
  accountId: cuidString.optional(),
  categoryId: cuidString.optional(),
})

// ─── DRE ────────────────────────────────────────────────────

export const dreQuerySchema = z.object({
  startDate: dateString,
  endDate: dateString,
})

// ─── Reconciliation ─────────────────────────────────────────

export const manualReconcileSchema = z.object({
  statementEntryId: cuidString,
  installmentId: cuidString,
})

export const autoReconcileSchema = z.object({
  accountId: cuidString,
  statementId: cuidString.optional(),
})

export const ignoreEntrySchema = z.object({
  statementEntryId: cuidString,
  notes: z.string().max(500).optional(),
})

export const undoReconcileSchema = z.object({
  reconciliationId: cuidString,
})

// ─── Boleto ─────────────────────────────────────────────────

export const generateBoletoSchema = z.object({
  installmentId: cuidString,
  dueDate: dateString.optional(),
})

// ─── Pix ────────────────────────────────────────────────────

export const generatePixSchema = z.object({
  installmentId: cuidString,
  expirationSeconds: z.number().int().min(60).max(86400).default(3600),
})

// ─── OFX Import ─────────────────────────────────────────────

export const importOFXSchema = z.object({
  accountId: cuidString,
})

// ─── Bank Sync (Inter) ──────────────────────────────────────

export const syncInterSchema = z.object({
  accountId: cuidString,
  startDate: dateString.optional(),
  endDate: dateString.optional(),
})

// ─── Card Sync (Rede) ───────────────────────────────────────

export const syncRedeSchema = z.object({
  accountId: cuidString,
  startDate: dateString.optional(),
  endDate: dateString.optional(),
})

// ═══════════════ NOTAS FISCAIS ═══════════════

// ─── Enums ──────────────────────────────────────────────────

export const fiscalProviderSchema = z.enum(['FOCUS_NFE', 'NFE_IO'])
export const fiscalEnvironmentSchema = z.enum(['HOMOLOGACAO', 'PRODUCAO'])
export const invoiceTypeSchema = z.enum(['NFE', 'NFCE', 'NFSE'])
export const invoiceStatusSchema = z.enum([
  'DRAFT', 'PROCESSING', 'AUTHORIZED', 'REJECTED',
  'CANCELLED', 'INUTILIZADA', 'CORRECTION_LETTER', 'ERROR',
])

// ─── Fiscal Config ──────────────────────────────────────────

export const fiscalConfigInputSchema = z.object({
  provider: fiscalProviderSchema.default('FOCUS_NFE'),
  environment: fiscalEnvironmentSchema.default('HOMOLOGACAO'),
  apiKey: z.string().min(1, 'API Key obrigatoria'),
  apiSecret: z.string().optional(),
  cnpj: z.string().regex(/^\d{14}$/, 'CNPJ deve ter 14 digitos'),
  razaoSocial: z.string().min(1, 'Razao social obrigatoria'),
  nomeFantasia: z.string().optional(),
  inscricaoEstadual: z.string().optional(),
  inscricaoMunicipal: z.string().optional(),
  regimeTributario: z.string().default('1'),
  codigoMunicipio: z.string().optional(),
  uf: z.string().length(2).optional(),
  serieNfe: z.number().int().min(1).default(1),
  cfopPadrao: z.string().default('5102'),
  naturezaOperacao: z.string().default('Venda de mercadoria'),
  serieNfse: z.number().int().min(1).default(1),
  codigoServicoPadrao: z.string().optional(),
  aliquotaIssPadrao: z.number().min(0).max(100).optional(),
})
export type FiscalConfigInput = z.infer<typeof fiscalConfigInputSchema>

// ─── NF-e Items ─────────────────────────────────────────────

export const createNFeItemSchema = z.object({
  productId: z.string().optional(),
  description: z.string().min(1, 'Descricao obrigatoria'),
  quantity: z.number().positive('Quantidade deve ser positiva'),
  unitPrice: z.number().int().positive('Preco unitario deve ser positivo (centavos)'),
  cfop: z.string().min(4).max(4),
  ncm: z.string().optional(),
  cst: z.string().optional(),
  unit: z.string().default('UN'),
})
export type CreateNFeItemInput = z.infer<typeof createNFeItemSchema>

// ─── NF-e Draft ─────────────────────────────────────────────

export const createNFeDraftSchema = z.object({
  customerId: z.string().min(1, 'Cliente obrigatorio'),
  nature: z.string().default('Venda de mercadoria'),
  items: z.array(createNFeItemSchema).min(1, 'Pelo menos 1 item obrigatorio'),
  paymentMethod: z.string().optional(),
  notes: z.string().optional(),
})
export type CreateNFeDraftInput = z.infer<typeof createNFeDraftSchema>

// ─── NFS-e Items ────────────────────────────────────────────

export const createNFSeItemSchema = z.object({
  description: z.string().min(1, 'Descricao obrigatoria'),
  serviceCode: z.string().optional(),
  quantity: z.number().positive(),
  unitPrice: z.number().int().positive('Valor em centavos'),
  issAliquota: z.number().min(0).max(100).optional(),
  issRetido: z.boolean().default(false),
})
export type CreateNFSeItemInput = z.infer<typeof createNFSeItemSchema>

// ─── NFS-e Draft ────────────────────────────────────────────

export const createNFSeDraftSchema = z.object({
  customerId: z.string().min(1, 'Cliente obrigatorio'),
  serviceOrderId: z.string().optional(),
  items: z.array(createNFSeItemSchema).min(1, 'Pelo menos 1 servico obrigatorio'),
  notes: z.string().optional(),
})
export type CreateNFSeDraftInput = z.infer<typeof createNFSeDraftSchema>

// ─── Cancel Invoice ─────────────────────────────────────────

export const cancelInvoiceSchema = z.object({
  reason: z.string().min(15, 'Justificativa deve ter no minimo 15 caracteres'),
})

// ─── Correction Letter ──────────────────────────────────────

export const correctionSchema = z.object({
  correctionText: z.string().min(15, 'Texto da correcao deve ter no minimo 15 caracteres'),
})

// ─── Inutilizacao ───────────────────────────────────────────

export const inutilizacaoSchema = z.object({
  series: z.number().int().min(1),
  startNumber: z.number().int().min(1),
  endNumber: z.number().int().min(1),
  justification: z.string().min(15, 'Justificativa deve ter no minimo 15 caracteres'),
}).refine(data => data.endNumber >= data.startNumber, {
  message: 'Numero final deve ser >= numero inicial',
  path: ['endNumber'],
})

// ─── Send Email ─────────────────────────────────────────────

export const sendEmailSchema = z.object({
  emails: z.array(z.string().email()).min(1, 'Pelo menos 1 email obrigatorio'),
})

// ─── Invoice List Query ─────────────────────────────────────

export const invoiceListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: invoiceStatusSchema.optional(),
  customerId: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  search: z.string().optional(),
})

// ─── NF Dashboard Query ────────────────────────────────────

export const nfDashboardQuerySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100).default(new Date().getFullYear()),
  month: z.coerce.number().int().min(1).max(12).optional(),
})
