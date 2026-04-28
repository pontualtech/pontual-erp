// =============================================================================
// app/api/voip/inbound-numbers/[id]/route.ts
// =============================================================================
// DELETE /api/voip/inbound-numbers/[id] — hard delete
// (DID pode ser reaproveitado por outra empresa após release pela operadora,
//  então não usamos soft delete aqui — UNIQUE em e164 precisa liberar.)
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { logVoipAudit } from "@/lib/voip/audit-log";

interface RouteCtx {
  params: { id: string };
}

export async function GET(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireSuperAdmin(req);
  if (!auth.ok) return auth.response;

  const item = await prisma.voipInboundNumber.findFirst({
    where: { id: params.id },
    include: {
      company:  { select: { id: true, name: true } },
      provider: { select: { id: true, name: true } },
    },
  });
  if (!item) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "DID não encontrado" } },
      { status: 404 },
    );
  }
  return NextResponse.json({ data: item });
}

export async function DELETE(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireSuperAdmin(req);
  if (!auth.ok) return auth.response;

  try {
    const deleted = await prisma.voipInboundNumber.delete({
      where: { id: params.id },
    });

    await logVoipAudit({
      companyId:  deleted.companyId,
      userId:     auth.user.id,
      action:     "inbound-number.deleted",
      entityType: "voip_inbound_number",
      entityId:   deleted.id,
      diff:       { before: deleted },
      request:    req,
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "DID não encontrado" } },
        { status: 404 },
      );
    }
    logger.error({ err: String(err) }, "voip.inbound-numbers.delete.failed");
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "Erro interno" } },
      { status: 500 },
    );
  }
}