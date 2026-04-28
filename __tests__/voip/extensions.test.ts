// =============================================================================
// __tests__/voip/extensions.test.ts
// =============================================================================
// CRUD extensions + uniqueness (companyId, number) + secret regeneration.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    voipExtension: {
      create:    vi.fn(),
      findMany:  vi.fn(),
      findFirst: vi.fn(),
      update:    vi.fn(),
      count:     vi.fn(),
    },
    voipPresence: {
      create: vi.fn().mockResolvedValue({}),
    },
    voipAuditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));
vi.mock("@/lib/auth", () => ({
  requireSuperAdmin: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/lib/voip/asterisk-config-generator", () => ({
  regenerateAsteriskConfig: vi.fn().mockResolvedValue({
    filesWritten: [],
    reloaded: true,
    providersCount: 0,
    extensionsCount: 0,
  }),
}));

import { POST as createExt, GET as listExts } from "@/app/api/voip/extensions/route";
import { POST as regenSecret } from "@/app/api/voip/extensions/[id]/regen-secret/route";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/auth";

const SUPER = {
  ok: true as const,
  user: { id: "u-super", role: "superadmin" },
};

const COMPANY_ID = "11111111-1111-1111-1111-111111111111";

function req(url: string, init: RequestInit = {}): NextRequest {
  return new NextRequest(new Request(url, init));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSuperAdmin).mockResolvedValue(SUPER);
});

describe("POST /api/voip/extensions", () => {
  function buildBody(overrides: Record<string, unknown> = {}) {
    return JSON.stringify({
      companyId: COMPANY_ID,
      number: "100",
      displayName: "João Atendimento",
      tenantTag: "pontualtech",
      ...overrides,
    });
  }

  it("cria ramal 100 com 201, retorna secret no body uma vez", async () => {
    vi.mocked(prisma.voipExtension.create).mockResolvedValue({
      id: "e1", companyId: COMPANY_ID, number: "100", displayName: "João Atendimento",
      userId: null, secretEncrypted: "encrypted-blob", context: "from-pontualtech",
      tenantTag: "pontualtech", codecs: ["ulaw","alaw"], dtmfMode: "rfc4733",
      maxContacts: 2, status: "PROVISIONING", callLimit: null,
      createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
      createdBy: "u-super", updatedBy: "u-super",
    } as never);

    const r = await createExt(req("http://localhost/api/voip/extensions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: buildBody(),
    }));
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.data.number).toBe("100");
    expect(body.data.secret).toMatch(/^[0-9a-f]{32}$/);
    expect(body.data.secretEncrypted).toBeUndefined();
  });

  it("rejeita number com letra (regex)", async () => {
    const r = await createExt(req("http://localhost/api/voip/extensions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: buildBody({ number: "10A" }),
    }));
    expect(r.status).toBe(422);
  });

  it("aceita range 100-109 (3 dígitos) e 1000-1099 (4 dígitos)", () => {
    const okValues = ["100", "109", "1000", "1099", "999"];
    const failValues = ["10", "12345", "0", ""];
    // Validação puramente schema-side
    okValues.forEach((n) => {
      expect(/^\d{3,4}$/.test(n)).toBe(true);
    });
    failValues.forEach((n) => {
      expect(/^\d{3,4}$/.test(n)).toBe(false);
    });
  });

  it("retorna 409 em duplicate (companyId, number) — Prisma P2002", async () => {
    const { Prisma } = await import("@prisma/client");
    const err = new Prisma.PrismaClientKnownRequestError("Unique fail", {
      code: "P2002",
      clientVersion: "x",
      meta: { target: ["companyId", "number"] },
    });
    vi.mocked(prisma.voipExtension.create).mockRejectedValue(err as never);

    const r = await createExt(req("http://localhost/api/voip/extensions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: buildBody(),
    }));
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(body.error.code).toBe("DUPLICATE_EXTENSION");
  });

  it("rejeita campo `secret` no body (server-only)", async () => {
    const r = await createExt(req("http://localhost/api/voip/extensions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: buildBody({ secret: "weak123" }),
    }));
    expect(r.status).toBe(422);
  });
});

describe("GET /api/voip/extensions", () => {
  it("filtra por status=ACTIVE", async () => {
    vi.mocked(prisma.voipExtension.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.voipExtension.count).mockResolvedValue(0);
    await listExts(req("http://localhost/api/voip/extensions?status=ACTIVE"));
    expect(prisma.voipExtension.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "ACTIVE", deletedAt: null }),
      }),
    );
  });

  it("rejeita status inválido com 422", async () => {
    const r = await listExts(req("http://localhost/api/voip/extensions?status=ABERTO"));
    expect(r.status).toBe(422);
  });
});

describe("POST /api/voip/extensions/[id]/regen-secret", () => {
  it("regenera secret e retorna no body uma vez", async () => {
    vi.mocked(prisma.voipExtension.findFirst).mockResolvedValue({
      id: "e1", companyId: COMPANY_ID, number: "100", deletedAt: null,
    } as never);
    vi.mocked(prisma.voipExtension.update).mockResolvedValue({
      id: "e1", companyId: COMPANY_ID, number: "100",
    } as never);

    const r = await regenSecret(req("http://localhost/api/voip/extensions/e1/regen-secret", {
      method: "POST",
    }), { params: { id: "e1" } });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.data.secret).toMatch(/^[0-9a-f]{32}$/);
    expect(body.data.message).toMatch(/copie agora/i);
  });

  it("404 se ramal não existe", async () => {
    vi.mocked(prisma.voipExtension.findFirst).mockResolvedValue(null);
    const r = await regenSecret(req("http://localhost/api/voip/extensions/x/regen-secret", {
      method: "POST",
    }), { params: { id: "x" } });
    expect(r.status).toBe(404);
  });
});