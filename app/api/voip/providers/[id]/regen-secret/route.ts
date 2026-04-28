// =============================================================================
// app/api/voip/providers/[id]/regen-secret/route.ts
// =============================================================================
// POST /api/voip/providers/[id]/regen-secret
// Regenera o secret do trunk (USER_SECRET only). Encripta e re-gera config.
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

  const provider = await prisma.voipProvider.findFirst({
    where: { id: params.id, deletedAt: null },
  });
  if (!provider) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Provider não encontrado" } },
      { status: 404 },
    );
  }

  if (provider.authMethod !== "USER_SECRET") {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_OPERATION",
          message: "Provider usa IP_BASED — não há secret pra regenerar",
        },
      },
      { status: 409 },
    );
  }

  // Gera novo secret, encripta e persiste
  const newSecret = generateSipSecret();
  const encrypted = encryptSecret(newSecret);

  const updated = await prisma.voipProvider.update({
    where: { id: provider.id },
    data: { secretEncrypted: encrypted, updatedBy: auth.user.id },
  });

  await logVoipAudit({
    companyId:  updated.companyId,
    userId:     auth.user.id,
    action:     "provider.regen-secret",
    entityType: "voip_provider",
    entityId:   updated.id,
    diff:       null, // não logar secret nem antes nem depois
    request:    req,
  });

  void regenerateAsteriskConfig({
    companyId: updated.companyId,
    triggeredBy: auth.user.id,
  }).catch((err) =>
    logger.error({ err: String(err) }, "voip.providers.regen.regenerate_failed"),
  );

  // ÚNICO lugar onde retornamos o secret em claro: imediatamente após gerar.
  // Super admin precisa copiar pro provedor (Sonax). Após isso, NUNCA exposto.
  return NextResponse.json({
    data: {
      id: updated.id,
      secret: newSecret,
      message: "Secret regenerado. Copie agora — não será exibido novamente.",
    },
  });
}