// =============================================================================
// __tests__/voip/zod-schemas.test.ts
// =============================================================================
// Verifica que .strict() rejeita campos extras (mass-assignment defense).
// Cobre todos os schemas de input do módulo.
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  createProviderSchema,
  updateProviderSchema,
  createExtensionSchema,
  updateExtensionSchema,
  createInboundNumberSchema,
  listExtensionsQuerySchema,
  deriveE164,
} from "@/lib/voip/zod-schemas";

const COMPANY_ID  = "11111111-1111-1111-1111-111111111111";
const USER_ID     = "22222222-2222-2222-2222-222222222222";
const PROVIDER_ID = "33333333-3333-3333-3333-333333333333";

describe("createProviderSchema", () => {
  const validIp: unknown = {
    companyId: COMPANY_ID,
    name: "Sonax PontualTech",
    hostOutbound: "proxy.sonavoip.com.br",
    authMethod: "IP_BASED",
    matchIp: "189.100.100.5",
    contextInbound: "from-sonax-pontualtech",
  };
  const validUserSecret: unknown = {
    companyId: COMPANY_ID,
    name: "Sonax PT (registration)",
    hostOutbound: "proxy.sonavoip.com.br",
    authMethod: "USER_SECRET",
    username: "pontualtech-trunk",
    secret: "senha-super-secreta",
    contextInbound: "from-sonax-pt-2",
  };

  it("aceita IP_BASED válido", () => {
    expect(createProviderSchema.safeParse(validIp).success).toBe(true);
  });
  it("aceita USER_SECRET válido", () => {
    expect(createProviderSchema.safeParse(validUserSecret).success).toBe(true);
  });
  it("rejeita campo extra (.strict)", () => {
    const result = createProviderSchema.safeParse({ ...(validIp as object), evilField: "x" });
    expect(result.success).toBe(false);
  });
  it("rejeita IP_BASED sem matchIp", () => {
    const { matchIp: _ignored, ...without } = validIp as Record<string, unknown>;
    const result = createProviderSchema.safeParse(without);
    expect(result.success).toBe(false);
  });
  it("rejeita USER_SECRET sem secret", () => {
    const { secret: _ignored, ...without } = validUserSecret as Record<string, unknown>;
    const result = createProviderSchema.safeParse(without);
    expect(result.success).toBe(false);
  });
  it("rejeita port fora do range", () => {
    const result = createProviderSchema.safeParse({ ...(validIp as object), port: 70000 });
    expect(result.success).toBe(false);
  });
  it("rejeita codec desconhecido", () => {
    const result = createProviderSchema.safeParse({
      ...(validIp as object),
      codecs: ["mp3"],
    });
    expect(result.success).toBe(false);
  });
});

describe("updateProviderSchema", () => {
  it("aceita objeto vazio (no-op update)", () => {
    expect(updateProviderSchema.safeParse({}).success).toBe(true);
  });
  it("rejeita campo extra", () => {
    const r = updateProviderSchema.safeParse({ companyId: "new-tenant" });
    expect(r.success).toBe(false);
  });
});

describe("createExtensionSchema", () => {
  const valid: unknown = {
    companyId: COMPANY_ID,
    number: "100",
    displayName: "João Atendimento",
    tenantTag: "pontualtech",
  };

  it("aceita ramal válido com defaults", () => {
    expect(createExtensionSchema.safeParse(valid).success).toBe(true);
  });
  it("rejeita number fora do regex (3-4 dígitos)", () => {
    const r = createExtensionSchema.safeParse({ ...(valid as object), number: "12" });
    expect(r.success).toBe(false);
  });
  it("rejeita tenantTag com espaços", () => {
    const r = createExtensionSchema.safeParse({ ...(valid as object), tenantTag: "Pontual Tech" });
    expect(r.success).toBe(false);
  });
  it("rejeita campo `secret` no body (server-only)", () => {
    const r = createExtensionSchema.safeParse({ ...(valid as object), secret: "x" });
    expect(r.success).toBe(false);
  });
  it("rejeita campo extra `role: admin` (mass-assignment)", () => {
    const r = createExtensionSchema.safeParse({ ...(valid as object), role: "admin" });
    expect(r.success).toBe(false);
  });
});

describe("updateExtensionSchema", () => {
  it("rejeita number (campo imutável)", () => {
    const r = updateExtensionSchema.safeParse({ number: "999" });
    expect(r.success).toBe(false);
  });
  it("rejeita companyId (campo imutável — anti-pattern B.4)", () => {
    const r = updateExtensionSchema.safeParse({ companyId: COMPANY_ID });
    expect(r.success).toBe(false);
  });
  it("aceita displayName isolado", () => {
    expect(updateExtensionSchema.safeParse({ displayName: "Novo Nome" }).success).toBe(true);
  });
});

describe("createInboundNumberSchema", () => {
  const valid: unknown = {
    companyId: COMPANY_ID,
    providerId: PROVIDER_ID,
    ddd: "11",
    number: "26263841",
    label: "Suporte",
  };

  it("aceita DID válido", () => {
    expect(createInboundNumberSchema.safeParse(valid).success).toBe(true);
  });
  it("rejeita DDD com 1 dígito", () => {
    const r = createInboundNumberSchema.safeParse({ ...(valid as object), ddd: "1" });
    expect(r.success).toBe(false);
  });
  it("rejeita number com letra", () => {
    const r = createInboundNumberSchema.safeParse({ ...(valid as object), number: "12abc" });
    expect(r.success).toBe(false);
  });
  it("rejeita campo extra", () => {
    const r = createInboundNumberSchema.safeParse({ ...(valid as object), companyTrick: "x" });
    expect(r.success).toBe(false);
  });
});

describe("deriveE164", () => {
  it("forma +55<ddd><number>", () => {
    expect(deriveE164("11", "26263841")).toBe("+551126263841");
    expect(deriveE164("21", "987654321")).toBe("+5521987654321");
  });
});

describe("listExtensionsQuerySchema", () => {
  it("coerce page/limit a number", () => {
    const r = listExtensionsQuerySchema.safeParse({ page: "2", limit: "10" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.page).toBe(2);
      expect(r.data.limit).toBe(10);
    }
  });
  it("limit > 100 rejeitado", () => {
    const r = listExtensionsQuerySchema.safeParse({ limit: "500" });
    expect(r.success).toBe(false);
  });
  it("status inválido rejeitado", () => {
    const r = listExtensionsQuerySchema.safeParse({ status: "ABERTO" });
    expect(r.success).toBe(false);
  });
});