// =============================================================================
// app/api/voip/providers/route.ts
// =============================================================================
// POST   /api/voip/providers — cria novo trunk SIP
// GET    /api/voip/providers — lista trunks
// Auth: super_admin only
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { encryptSecret, maskSecret } from "@/lib/voip/encryption";
import { logVoipAudit } from "@/lib/voip/audit-log";
import {
  createProviderSchema,
  listProvidersQuerySchema,
} from "@/lib/voip/zod-schemas";
import { regenerateAsteriskConfig } from "@/lib/voip/asterisk-config-generator";

// -----------------------------------------------------------------------------
// POST /api/voip/providers
// -----------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  // Auth
  const auth = await requireSuperAdmin(req);
  if (!auth.ok) return auth.response;

  // Rate-limit defensivo (mesmo super-admin — protege contra credential leak)
  const rl = await rateLimit(req, { key: "voip:providers:create", limit: 30, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Muitas tentativas. Aguarde 1 min." } },
      { status: 429 },
    );
  }

  // Validation
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Body inválido" } },
      { status: 400 },
    );
  }

  const parsed = createProviderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Campos inválidos",
          details: parsed.error.flatten(),
        },
      },
      { status: 422 },
    );
  }

  const data = parsed.data;

  try {
    const created = await prisma.voipProvider.create({
      data: {
        companyId:        data.companyId,
        name:             data.name,
        hostOutbound:     data.hostOutbound,
        hostInbound:      data.hostInbound,
        port:             data.port,
        transport:        data.transport,
        authMethod:       data.authMethod,
        username:         data.username,
        secretEncrypted:  data.secret ? encryptSecret(data.secret) : null,
        matchIp:          data.matchIp,
        codecs:           data.codecs,
        dtmfMode:         data.dtmfMode,
        qualifyFrequency: data.qualifyFrequency,
        contextOutbound:  data.contextOutbound,
        contextInbound:   data.contextInbound,
        createdBy:        auth.user.id,
        updatedBy:        auth.user.id,
      },
    });

    // Audit (sem secret em claro — redactDiff strip)
    await logVoipAudit({
      companyId:  created.companyId,
      userId:     auth.user.id,
      action:     "provider.created",
      entityType: "voip_provider",
      entityId:   created.id,
      diff:       { after: data },
      request:    req,
    });

    // Trigger regenerate config em background (non-blocking)
    // Ignoramos resultado/erros aqui — se falhar, super admin pode rodar manual.
    void regenerateAsteriskConfig({
      companyId: created.companyId,
      triggeredBy: auth.user.id,
    }).catch((err) =>
      logger.error({ err: String(err) }, "voip.providers.create.regenerate_failed"),
    );

    return NextResponse.json(
      {
        data: {
          ...created,
          secretEncrypted: undefined, // never expose
          ...maskSecret(created.secretEncrypted),
        },
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2003") {
        // FK violada — companyId não existe
        return NextResponse.json(
          { error: { code: "INVALID_COMPANY", message: "Empresa não existe" } },
          { status: 400 },
        );
      }
    }
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "voip.providers.create.failed");
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "Erro interno ao criar provider" } },
      { status: 500 },
    );
  }
}

// -----------------------------------------------------------------------------
// GET /api/voip/providers
// -----------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const queryRaw = Object.fromEntries(url.searchParams.entries());
  const parsed = listProvidersQuerySchema.safeParse(queryRaw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } },
      { status: 422 },
    );
  }

  const { companyId, isActive, page, limit } = parsed.data;

  // Even super_admin: filtro EXPLÍCITO (anti-pattern B.1).
  // Default scope: tudo. Quando companyId é fornecido, filtra.
  const where: Prisma.VoipProviderWhereInput = {
    deletedAt: null,
    ...(companyId !== undefined ? { companyId } : {}),
    ...(isActive !== undefined ? { isActive } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.voipProvider.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: { company: { select: { id: true, name: true } } },
    }),
    prisma.voipProvider.count({ where }),
  ]);

  return NextResponse.json({
    data: items.map((p) => ({
      ...p,
      secretEncrypted: undefined,
      ...maskSecret(p.secretEncrypted),
    })),
    total,
    page,
    limit,
  });
}