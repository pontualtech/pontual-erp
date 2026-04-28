// =============================================================================
// app/api/voip/extensions/[id]/route.ts
// =============================================================================
// GET    /api/voip/extensions/[id]
// PUT    /api/voip/extensions/[id]   (não permite mudar number nem companyId)
// DELETE /api/voip/extensions/[id]   (soft delete + status = DISABLED)
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { maskSecret } from "@/lib/voip/encryption";
import { logVoipAudit } from "@/lib/voip/audit-log";
import { updateExtensionSchema } from "@/lib/voip/zod-schemas";
import { regenerateAsteriskConfig } from "@/lib/voip/asterisk-config-generator";

interface RouteCtx {
  params: { id: string };
}

// -----------------------------------------------------------------------------
// GET
// -----------------------------------------------------------------------------
export async function GET(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireSuperAdmin(req);
  if (!auth.ok) return auth.response;

  const ext = await prisma.voipExtension.findFirst({
    where: { id: params.id, deletedAt: null },
    include: {
      company:  { select: { id: true, name: true } },
      presence: true,
    },
  });

  if (!ext) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Ramal não encontrado" } },
      { status: 404 },
    );
  }

  return NextResponse.json({
    data: {
      ...ext,
      secretEncrypted: undefined,
      ...maskSecret(ext.secretEncrypted),
    },
  });
}

// -----------------------------------------------------------------------------
// PUT
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

  const parsed = updateExtensionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } },
      { status: 422 },
    );
  }

  const data = parsed.data;

  const before = await prisma.voipExtension.findFirst({
    where: { id: params.id, deletedAt: null },
  });
  if (!before) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Ramal não encontrado" } },
      { status: 404 },
    );
  }

  const updateData: Prisma.VoipExtensionUpdateInput = {
    displayName: data.displayName,
    userId:      data.userId,
    context:     data.context,
    tenantTag:   data.tenantTag,
    codecs:      data.codecs,
    dtmfMode:    data.dtmfMode,
    maxContacts: data.maxContacts,
    callLimit:   data.callLimit,
    status:      data.status,
    updatedBy:   auth.user.id,
  };
  for (const k of Object.keys(updateData) as Array<keyof typeof updateData>) {
    if (updateData[k] === undefined) delete updateData[k];
  }

  try {
    const updated = await prisma.voipExtension.update({
      where: { id: params.id },
      data: updateData,
    });

    await logVoipAudit({
      companyId:  updated.companyId,
      userId:     auth.user.id,
      action:     "extension.updated",
      entityType: "voip_extension",
      entityId:   updated.id,
      diff:       { before, after: data },
      request:    req,
    });

    void regenerateAsteriskConfig({
      companyId: updated.companyId,
      triggeredBy: auth.user.id,
    }).catch((err) =>
      logger.error({ err: String(err) }, "voip.extensions.update.regenerate_failed"),
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
        { error: { code: "NOT_FOUND", message: "Ramal não encontrado" } },
        { status: 404 },
      );
    }
    logger.error({ err: String(err) }, "voip.extensions.update.failed");
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "Erro interno" } },
      { status: 500 },
    );
  }
}

// -----------------------------------------------------------------------------
// DELETE — soft delete + status = DISABLED
// -----------------------------------------------------------------------------
export async function DELETE(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireSuperAdmin(req);
  if (!auth.ok) return auth.response;

  try {
    const deleted = await prisma.voipExtension.update({
      where: { id: params.id },
      data: {
        deletedAt: new Date(),
        status: "DISABLED",
        updatedBy: auth.user.id,
      },
    });

    await logVoipAudit({
      companyId:  deleted.companyId,
      userId:     auth.user.id,
      action:     "extension.deleted",
      entityType: "voip_extension",
      entityId:   deleted.id,
      diff:       { before: deleted },
      request:    req,
    });

    void regenerateAsteriskConfig({
      companyId: deleted.companyId,
      triggeredBy: auth.user.id,
    }).catch((err) =>
      logger.error({ err: String(err) }, "voip.extensions.delete.regenerate_failed"),
    );

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Ramal não encontrado" } },
        { status: 404 },
      );
    }
    logger.error({ err: String(err) }, "voip.extensions.delete.failed");
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "Erro interno" } },
      { status: 500 },
    );
  }
}