// =============================================================================
// app/api/voip/providers/[id]/route.ts
// =============================================================================
// GET    /api/voip/providers/[id]
// PUT    /api/voip/providers/[id]
// DELETE /api/voip/providers/[id]   (soft delete)
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { encryptSecret, maskSecret } from "@/lib/voip/encryption";
import { logVoipAudit } from "@/lib/voip/audit-log";
import { updateProviderSchema } from "@/lib/voip/zod-schemas";
import { regenerateAsteriskConfig } from "@/lib/voip/asterisk-config-generator";

interface RouteCtx {
  params: { id: string };
}

// -----------------------------------------------------------------------------
// GET /api/voip/providers/[id]
// -----------------------------------------------------------------------------
export async function GET(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireSuperAdmin(req);
  if (!auth.ok) return auth.response;

  const provider = await prisma.voipProvider.findFirst({
    where: { id: params.id, deletedAt: null },
    include: { company: { select: { id: true, name: true } }, inboundNumbers: true },
  });

  if (!provider) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Provider não encontrado" } },
      { status: 404 },
    );
  }

  return NextResponse.json({
    data: {
      ...provider,
      secretEncrypted: undefined,
      ...maskSecret(provider.secretEncrypted),
    },
  });
}

// -----------------------------------------------------------------------------
// PUT /api/voip/providers/[id]
// -----------------------------------------------------------------------------
export async function PUT(req: NextRequest, { params }: RouteCtx) {
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

  const parsed = updateProviderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } },
      { status: 422 },
    );
  }

  const data = parsed.data;

  // Carrega estado anterior para audit diff
  const before = await prisma.voipProvider.findFirst({
    where: { id: params.id, deletedAt: null },
  });
  if (!before) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Provider não encontrado" } },
      { status: 404 },
    );
  }

  // Re-encripta secret se mudou
  const updateData: Prisma.VoipProviderUpdateInput = {
    name:             data.name,
    hostOutbound:     data.hostOutbound,
    hostInbound:      data.hostInbound,
    port:             data.port,
    transport:        data.transport,
    authMethod:       data.authMethod,
    username:         data.username,
    matchIp:          data.matchIp,
    codecs:           data.codecs,
    dtmfMode:         data.dtmfMode,
    qualifyFrequency: data.qualifyFrequency,
    contextOutbound:  data.contextOutbound,
    contextInbound:   data.contextInbound,
    isActive:         data.isActive,
    updatedBy:        auth.user.id,
  };

  if (data.secret !== undefined) {
    updateData.secretEncrypted = encryptSecret(data.secret);
  }

  // Strip undefined keys (Prisma trata undefined como "no-op", mas explícito é melhor)
  for (const k of Object.keys(updateData) as Array<keyof typeof updateData>) {
    if (updateData[k] === undefined) delete updateData[k];
  }

  try {
    const updated = await prisma.voipProvider.update({
      where: { id: params.id },
      data: updateData,
    });

    await logVoipAudit({
      companyId:  updated.companyId,
      userId:     auth.user.id,
      action:     "provider.updated",
      entityType: "voip_provider",
      entityId:   updated.id,
      diff:       { before, after: data },
      request:    req,
    });

    void regenerateAsteriskConfig({
      companyId: updated.companyId,
      triggeredBy: auth.user.id,
    }).catch((err) =>
      logger.error({ err: String(err) }, "voip.providers.update.regenerate_failed"),
    );

    return NextResponse.json({
      data: {
        ...updated,
        secretEncrypted: undefined,
        ...maskSecret(updated.secretEncrypted),
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Provider não encontrado" } },
        { status: 404 },
      );
    }
    logger.error({ err: String(err) }, "voip.providers.update.failed");
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "Erro interno" } },
      { status: 500 },
    );
  }
}

// -----------------------------------------------------------------------------
// DELETE /api/voip/providers/[id] — soft delete
// -----------------------------------------------------------------------------
export async function DELETE(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireSuperAdmin(req);
  if (!auth.ok) return auth.response;

  // Bloqueia se ainda há inbound numbers ativos apontando pra este provider
  const inboundCount = await prisma.voipInboundNumber.count({
    where: { providerId: params.id, isActive: true },
  });
  if (inboundCount > 0) {
    return NextResponse.json(
      {
        error: {
          code: "CONFLICT",
          message: `Provider tem ${inboundCount} DID(s) ativo(s). Remova ou desative os DIDs antes.`,
        },
      },
      { status: 409 },
    );
  }

  try {
    const deleted = await prisma.voipProvider.update({
      where: { id: params.id },
      data: { deletedAt: new Date(), updatedBy: auth.user.id, isActive: false },
    });

    await logVoipAudit({
      companyId:  deleted.companyId,
      userId:     auth.user.id,
      action:     "provider.deleted",
      entityType: "voip_provider",
      entityId:   deleted.id,
      diff:       { before: deleted },
      request:    req,
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Provider não encontrado" } },
        { status: 404 },
      );
    }
    logger.error({ err: String(err) }, "voip.providers.delete.failed");
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "Erro interno" } },
      { status: 500 },
    );
  }
}