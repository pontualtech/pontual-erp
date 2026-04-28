// =============================================================================
// __tests__/voip/providers.test.ts
// =============================================================================
// Integration tests para CRUD de providers + tenant isolation (RLS).
// Mock de Prisma + auth + rate-limit. Roda contra ambiente de teste.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mocks ANTES de importar handlers
vi.mock("@/lib/prisma", () => ({
  prisma: {
    voipProvider: {
      create:    vi.fn(),
      findMany:  vi.fn(),
      findFirst: vi.fn(),
      update:    vi.fn(),
      count:     vi.fn(),
    },
    voipInboundNumber: {
      count: vi.fn(),
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
  rateLimit: vi.fn().mockResolvedValue({ ok: true, remaining: 99 }),
}));
vi.mock("@/lib/voip/asterisk-config-generator", () => ({
  regenerateAsteriskConfig: vi.fn().mockResolvedValue({
    filesWritten: [],
    reloaded: true,
    providersCount: 0,
    extensionsCount: 0,
  }),
}));

import { POST as createProvider, GET as listProviders } from "@/app/api/voip/providers/route";
import { GET as getProvider, PUT as updateProvider, DELETE as deleteProvider } from "@/app/api/voip/providers/[id]/route";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/auth";

const SUPER_ADMIN = {
  ok: true as const,
  user: { id: "00000000-0000-0000-0000-000000000001", role: "superadmin" },
};
const REGULAR_USER_RESP = {
  ok: false as const,
  response: new Response(JSON.stringify({ error: { code: "FORBIDDEN" } }), { status: 403 }),
};

const COMPANY_ID = "11111111-1111-1111-1111-111111111111";

function makeRequest(url: string, init: RequestInit = {}): NextRequest {
  return new NextRequest(new Request(url, init));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSuperAdmin).mockResolvedValue(SUPER_ADMIN);
});

describe("POST /api/voip/providers", () => {
  it("cria provider IP_BASED com 201", async () => {
    vi.mocked(prisma.voipProvider.create).mockResolvedValue({
      id: "p1", companyId: COMPANY_ID, name: "Sonax", hostOutbound: "proxy.sonavoip.com.br",
      hostInbound: null, port: 5060, transport: "udp", authMethod: "IP_BASED",
      username: null, secretEncrypted: null, matchIp: "189.100.0.1",
      codecs: ["ulaw", "alaw"], dtmfMode: "rfc4733", qualifyFrequency: 60,
      contextOutbound: "from-internal", contextInbound: "from-sonax",
      isActive: true, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
      createdBy: SUPER_ADMIN.user.id, updatedBy: SUPER_ADMIN.user.id,
    } as never);

    const req = makeRequest("http://localhost/api/voip/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        companyId: COMPANY_ID,
        name: "Sonax",
        hostOutbound: "proxy.sonavoip.com.br",
        authMethod: "IP_BASED",
        matchIp: "189.100.0.1",
        contextInbound: "from-sonax",
      }),
    });

    const res = await createProvider(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.id).toBe("p1");
    expect(body.data.secretEncrypted).toBeUndefined();
    expect(body.data.hasSecret).toBe(false);
  });

  it("rejeita user não-super-admin com 403", async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValue(REGULAR_USER_RESP);
    const req = makeRequest("http://localhost/api/voip/providers", { method: "POST" });
    const res = await createProvider(req);
    expect(res.status).toBe(403);
  });

  it("rejeita body com campo extra (mass-assignment)", async () => {
    const req = makeRequest("http://localhost/api/voip/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        companyId: COMPANY_ID,
        name: "X",
        hostOutbound: "x.com",
        authMethod: "IP_BASED",
        matchIp: "1.1.1.1",
        contextInbound: "from-x",
        evilField: "hack",
      }),
    });
    const res = await createProvider(req);
    expect(res.status).toBe(422);
  });

  it("rejeita JSON inválido com 400", async () => {
    const req = makeRequest("http://localhost/api/voip/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{nonono}",
    });
    const res = await createProvider(req);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/voip/providers", () => {
  it("lista todos sem filtro (super admin)", async () => {
    vi.mocked(prisma.voipProvider.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.voipProvider.count).mockResolvedValue(0);
    const req = makeRequest("http://localhost/api/voip/providers");
    const res = await listProviders(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(0);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(50);
  });

  it("filtra por companyId quando fornecido", async () => {
    vi.mocked(prisma.voipProvider.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.voipProvider.count).mockResolvedValue(0);
    const req = makeRequest(`http://localhost/api/voip/providers?companyId=${COMPANY_ID}`);
    await listProviders(req);
    expect(prisma.voipProvider.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: COMPANY_ID }),
      }),
    );
  });

  it("rejeita limit > 100", async () => {
    const req = makeRequest("http://localhost/api/voip/providers?limit=999");
    const res = await listProviders(req);
    expect(res.status).toBe(422);
  });
});

describe("DELETE /api/voip/providers/[id]", () => {
  it("retorna 409 se há DIDs ativos apontando", async () => {
    vi.mocked(prisma.voipInboundNumber.count).mockResolvedValue(3);
    const req = makeRequest("http://localhost/api/voip/providers/p1", { method: "DELETE" });
    const res = await deleteProvider(req, { params: { id: "p1" } });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("CONFLICT");
  });

  it("soft-deleta com 204 quando sem DIDs", async () => {
    vi.mocked(prisma.voipInboundNumber.count).mockResolvedValue(0);
    vi.mocked(prisma.voipProvider.update).mockResolvedValue({
      id: "p1", companyId: COMPANY_ID, deletedAt: new Date(), isActive: false,
    } as never);
    const req = makeRequest("http://localhost/api/voip/providers/p1", { method: "DELETE" });
    const res = await deleteProvider(req, { params: { id: "p1" } });
    expect(res.status).toBe(204);
  });
});

describe("Tenant isolation (RLS smoke)", () => {
  // Estes testes validam o nosso CONTRATO no código backend.
  // Validação real de RLS Postgres roda em integration test contra DB de teste.
  it("DELETE não vaza id de outro tenant: P2025 → 404", async () => {
    vi.mocked(prisma.voipInboundNumber.count).mockResolvedValue(0);
    const err = Object.assign(new Error("Record not found"), {
      code: "P2025",
      clientVersion: "x",
      meta: {},
    });
    // Simula Prisma KnownRequestError
    Object.setPrototypeOf(err, (await import("@prisma/client")).Prisma.PrismaClientKnownRequestError.prototype);
    vi.mocked(prisma.voipProvider.update).mockRejectedValue(err as never);
    const req = makeRequest("http://localhost/api/voip/providers/other-tenant-id", {
      method: "DELETE",
    });
    const res = await deleteProvider(req, { params: { id: "other-tenant-id" } });
    expect(res.status).toBe(404);
  });
});