// =============================================================================
// lib/voip/zod-schemas.ts
// =============================================================================
// Schemas Zod .strict() para todos os endpoints /api/voip/*.
// .strict() bloqueia mass-assignment (anti-pattern C.6 / OWASP A01-04).
// Reusa helpers existentes (lib/phone.ts) onde possível.
// =============================================================================

import { z } from "zod";

// -----------------------------------------------------------------------------
// Primitives reutilizáveis
// -----------------------------------------------------------------------------
const uuidSchema      = z.string().uuid();
const extNumberSchema = z.string().regex(/^\d{3,4}$/, "Número de ramal: 3-4 dígitos (ex: 100)");
const tenantTagSchema = z.string().regex(/^[a-z0-9-]{2,40}$/, "tenant_tag: lowercase alfanumérico + hífen, 2-40 chars");
const codecSchema     = z.enum(["ulaw", "alaw", "g729", "opus"]);
const dtmfModeSchema  = z.enum(["rfc4733", "inband", "info"]);
const transportSchema = z.enum(["udp", "tcp", "tls"]);
const dddSchema       = z.string().regex(/^\d{2}$/, "DDD: 2 dígitos");
const phoneSchema     = z.string().regex(/^\d{8,9}$/, "Número: 8-9 dígitos sem DDD");

// -----------------------------------------------------------------------------
// 1) Provider — create
// -----------------------------------------------------------------------------
export const createProviderSchema = z.object({
  companyId:        uuidSchema,
  name:             z.string().min(2).max(100),
  hostOutbound:     z.string().min(3).max(200),
  hostInbound:      z.string().min(3).max(200).optional(),
  port:             z.number().int().min(1).max(65535).default(5060),
  transport:        transportSchema.default("udp"),
  authMethod:       z.enum(["IP_BASED", "USER_SECRET"]),
  username:         z.string().min(1).max(100).optional(),
  // secret é plaintext aqui — handler encripta antes de persistir.
  // Nunca logar este campo (lib/logger.ts redact paths inclui "secret").
  secret:           z.string().min(8).max(200).optional(),
  matchIp:          z.string().max(50).optional(),
  codecs:           z.array(codecSchema).min(1).max(8).default(["ulaw", "alaw"]),
  dtmfMode:         dtmfModeSchema.default("rfc4733"),
  qualifyFrequency: z.number().int().min(0).max(3600).default(60),
  contextOutbound:  z.string().min(2).max(80).default("from-internal"),
  contextInbound:   z.string().min(2).max(80),
})
  .strict()
  .refine(
    (d) => (d.authMethod === "IP_BASED" ? !!d.matchIp : !!d.username && !!d.secret),
    {
      message:
        "matchIp obrigatório se authMethod=IP_BASED; username+secret obrigatórios se authMethod=USER_SECRET",
      path: ["authMethod"],
    },
  );

export type CreateProviderInput = z.infer<typeof createProviderSchema>;

// -----------------------------------------------------------------------------
// 2) Provider — update (parcial)
// -----------------------------------------------------------------------------
// Mesmas regras do create, mas campos opcionais. companyId é IMUTÁVEL — não
// permite migrar provider entre tenants (anti-pattern B.4).
export const updateProviderSchema = z
  .object({
    name:             z.string().min(2).max(100).optional(),
    hostOutbound:     z.string().min(3).max(200).optional(),
    hostInbound:      z.string().min(3).max(200).nullable().optional(),
    port:             z.number().int().min(1).max(65535).optional(),
    transport:        transportSchema.optional(),
    authMethod:       z.enum(["IP_BASED", "USER_SECRET"]).optional(),
    username:         z.string().min(1).max(100).nullable().optional(),
    secret:           z.string().min(8).max(200).optional(),
    matchIp:          z.string().max(50).nullable().optional(),
    codecs:           z.array(codecSchema).min(1).max(8).optional(),
    dtmfMode:         dtmfModeSchema.optional(),
    qualifyFrequency: z.number().int().min(0).max(3600).optional(),
    contextOutbound:  z.string().min(2).max(80).optional(),
    contextInbound:   z.string().min(2).max(80).optional(),
    isActive:         z.boolean().optional(),
  })
  .strict();

export type UpdateProviderInput = z.infer<typeof updateProviderSchema>;

// -----------------------------------------------------------------------------
// 3) Extension — create
// -----------------------------------------------------------------------------
// secret NÃO vem do client (evita weak passwords e mass-assignment).
// Servidor gera via crypto.randomBytes (lib/voip/encryption.ts:generateSipSecret).
export const createExtensionSchema = z.object({
  companyId:    uuidSchema,
  number:       extNumberSchema,
  displayName:  z.string().min(2).max(80),
  userId:       uuidSchema.optional(),
  context:      z.string().min(2).max(80).default("from-pontualtech"),
  tenantTag:    tenantTagSchema,
  codecs:       z.array(codecSchema).min(1).max(8).default(["ulaw", "alaw"]),
  dtmfMode:     dtmfModeSchema.default("rfc4733"),
  maxContacts:  z.number().int().min(1).max(5).default(2),
  callLimit:    z.number().int().min(1).max(20).optional(),
  status:       z.enum(["ACTIVE", "DISABLED", "PROVISIONING"]).default("PROVISIONING"),
}).strict();

export type CreateExtensionInput = z.infer<typeof createExtensionSchema>;

// -----------------------------------------------------------------------------
// 4) Extension — update
// -----------------------------------------------------------------------------
// number e companyId são imutáveis — anti-pattern B.4 (migração silenciosa).
export const updateExtensionSchema = z
  .object({
    displayName:  z.string().min(2).max(80).optional(),
    userId:       uuidSchema.nullable().optional(),
    context:      z.string().min(2).max(80).optional(),
    tenantTag:    tenantTagSchema.optional(),
    codecs:       z.array(codecSchema).min(1).max(8).optional(),
    dtmfMode:     dtmfModeSchema.optional(),
    maxContacts:  z.number().int().min(1).max(5).optional(),
    callLimit:    z.number().int().min(1).max(20).nullable().optional(),
    status:       z.enum(["ACTIVE", "DISABLED", "PROVISIONING"]).optional(),
  })
  .strict();

export type UpdateExtensionInput = z.infer<typeof updateExtensionSchema>;

// -----------------------------------------------------------------------------
// 5) Inbound number — create
// -----------------------------------------------------------------------------
// e164 é DERIVADO (não vem do client). Server normaliza pra `+55${ddd}${number}`.
export const createInboundNumberSchema = z.object({
  companyId:  uuidSchema,
  providerId: uuidSchema,
  ddd:        dddSchema,
  number:     phoneSchema,
  label:      z.string().min(2).max(40),
}).strict();

export type CreateInboundNumberInput = z.infer<typeof createInboundNumberSchema>;

// -----------------------------------------------------------------------------
// 6) Regen secret (param-only — body vazio)
// -----------------------------------------------------------------------------
export const regenSecretParamsSchema = z.object({
  id: uuidSchema,
}).strict();

export type RegenSecretParams = z.infer<typeof regenSecretParamsSchema>;

// -----------------------------------------------------------------------------
// 7) Query schemas (filtros de listagem)
// -----------------------------------------------------------------------------
export const listProvidersQuerySchema = z.object({
  companyId: uuidSchema.optional(),
  isActive:  z.enum(["true", "false"]).optional().transform((v) => (v === undefined ? undefined : v === "true")),
  page:      z.coerce.number().int().min(1).default(1),
  limit:     z.coerce.number().int().min(1).max(100).default(50),
}).strict();

export const listExtensionsQuerySchema = z.object({
  companyId: uuidSchema.optional(),
  status:    z.enum(["ACTIVE", "DISABLED", "PROVISIONING"]).optional(),
  userId:    uuidSchema.optional(),
  page:      z.coerce.number().int().min(1).default(1),
  limit:     z.coerce.number().int().min(1).max(100).default(50),
}).strict();

export const listInboundNumbersQuerySchema = z.object({
  companyId:  uuidSchema.optional(),
  providerId: uuidSchema.optional(),
  isActive:   z.enum(["true", "false"]).optional().transform((v) => (v === undefined ? undefined : v === "true")),
  page:       z.coerce.number().int().min(1).default(1),
  limit:      z.coerce.number().int().min(1).max(100).default(50),
}).strict();

// -----------------------------------------------------------------------------
// 8) Regenerate config — opcional companyId (escopa por tenant)
// -----------------------------------------------------------------------------
export const regenerateConfigQuerySchema = z.object({
  companyId: uuidSchema.optional(),
}).strict();

// -----------------------------------------------------------------------------
// Helper: e164 derivation (não exposto no schema, usado no handler)
// -----------------------------------------------------------------------------
export function deriveE164(ddd: string, number: string): string {
  return `+55${ddd}${number}`;
}