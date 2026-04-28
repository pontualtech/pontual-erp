// =============================================================================
// app/api/voip/inbound-numbers/route.ts
// =============================================================================
// POST /api/voip/inbound-numbers — cadastra DID
// GET  /api/voip/inbound-numbers — lista DIDs
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { logVoipAudit } from "@/lib/voip/audit-log";
import {
  createInboundNumberSchema,
  deriveE164,
  listInboundNumbersQuerySchema,
} from "@/lib/voip/zod-schemas";

// -----------------------------------------------------------------------------
// POST
// -----------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Body inválido" } },
      { status: 400 },
    );
  }

  const parsed = createInboundNumberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } },
      { status: 422 },
    );
  }

  const data = parsed.data;
  const e164 = deriveE164(data.ddd, data.number);

  // Valida que provider pertence à mesma company (anti-pattern B.4)
  const provider = await prisma.voipProvider.findFirst({
    where: { id: data.providerId, deletedAt: null },
  });
  if (!provider) {
    return NextResponse.json(
      { error: { code: "INVALID_REFERENCE", message: "Provider não existe" } },
      { status: 400 },
    );
  }
  if (provider.companyId !== data.companyId) {
    return NextResponse.json(
      {
        error: {
          code: "TENANT_MISMATCH",
          message: "Provider pertence a outra empresa",
        },
      },
      { status: 403 },
    );
  }

  try {
    const created = await prisma.voipInboundNumber.create({
      data: {
        companyId:  data.companyId,
        providerId: data.providerId,
        ddd:        data.ddd,
        number:     data.number,
        e164,
        label:      data.label,
        createdBy:  auth.user.id,
      },
    });

    await logVoipAudit({
      companyId:  created.companyId,
      userId:     auth.user.id,
      action:     "inbound-number.created",
      entityType: "voip_inbound_number",
      entityId:   created.id,
      diff:       { after: data },
      request:    req,
    });

    return NextResponse.json({ data: created }, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") {
        return NextResponse.json(
          { error: { code: "DUPLICATE_DID", message: `Número ${e164} já cadastrado` } },
          { status: 409 },
        );
      }
    }
    logger.error({ err: String(err) }, "voip.inbound-numbers.create.failed");
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "Erro interno" } },
      { status: 500 },
    );
  }
}

// -----------------------------------------------------------------------------
// GET
// -----------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const queryRaw = Object.fromEntries(url.searchParams.entries());
  const parsed = listInboundNumbersQuerySchema.safeParse(queryRaw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } },
      { status: 422 },
    );
  }

  const { companyId, providerId, isActive, page, limit } = parsed.data;

  const where: Prisma.VoipInboundNumberWhereInput = {
    ...(companyId  !== undefined ? { companyId } : {}),
    ...(providerId !== undefined ? { providerId } : {}),
    ...(isActive   !== undefined ? { isActive } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.voipInboundNumber.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        company:  { select: { id: true, name: true } },
        provider: { select: { id: true, name: true } },
      },
    }),
    prisma.voipInboundNumber.count({ where }),
  ]);

  return NextResponse.json({ data: items, total, page, limit });
}