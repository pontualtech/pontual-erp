// =============================================================================
// app/api/voip/extensions/[id]/regen-secret/route.ts
// =============================================================================
// POST /api/voip/extensions/[id]/regen-secret
// Regenera secret SIP do ramal — usado quando senha vazou ou troca de softphone.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { encryptSecret, generateSipSecret } from "@/lib/voip/encryption";
import { logVoipAudit } from "@/lib/voip/audit-log";
import { regenerateAsteriskConfig } from "@/lib/voip/asterisk-config-generator";

interface RouteCtx {
  params: { id: string };
}

export async function POST(req: NextRequest, { params }: RouteCtx) {
  const auth = await requireSuperAdmin(req);
  if (!auth.ok) return auth.response;

  const ext = await prisma.voipExtension.findFirst({
    where: { id: params.id, deletedAt: null },
  });
  if (!ext) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Ramal não encontrado" } },
      { status: 404 },
    );
  }

  const newSecret = generateSipSecret();
  const updated = await prisma.voipExtension.update({
    where: { id: ext.id },
    data: { secretEncrypted: encryptSecret(newSecret), updatedBy: auth.user.id },
  });

  await logVoipAudit({
    companyId:  updated.companyId,
    userId:     auth.user.id,
    action:     "extension.regen-secret",
    entityType: "voip_extension",
    entityId:   updated.id,
    diff:       null, // não logar secret
    request:    req,
  });

  void regenerateAsteriskConfig({
    companyId: updated.companyId,
    triggeredBy: auth.user.id,
  }).catch((err) =>
    logger.error({ err: String(err) }, "voip.extensions.regen.regenerate_failed"),
  );

  return NextResponse.json({
    data: {
      id: updated.id,
      number: updated.number,
      secret: newSecret,
      message: "Secret regenerado. Copie agora — não será exibido novamente.",
    },
  });
}