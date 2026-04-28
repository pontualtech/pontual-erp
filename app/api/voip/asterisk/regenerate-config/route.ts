// =============================================================================
// app/api/voip/asterisk/regenerate-config/route.ts
// =============================================================================
// POST /api/voip/asterisk/regenerate-config?companyId=XXX
// Regenera os 5 .conf do Asterisk a partir do DB e dispara reload via ARI.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { regenerateAsteriskConfig } from "@/lib/voip/asterisk-config-generator";
import { regenerateConfigQuerySchema } from "@/lib/voip/zod-schemas";

export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const queryRaw = Object.fromEntries(url.searchParams.entries());
  const parsed = regenerateConfigQuerySchema.safeParse(queryRaw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } },
      { status: 422 },
    );
  }

  try {
    const result = await regenerateAsteriskConfig({
      companyId: parsed.data.companyId,
      triggeredBy: auth.user.id,
    });

    return NextResponse.json({
      data: {
        filesWritten: result.filesWritten.length,
        reloaded: result.reloaded,
        providersCount: result.providersCount,
        extensionsCount: result.extensionsCount,
      },
    });
  } catch (err) {
    // Detalhe completo (incl. stack + paths internos como /var/lib/coolify/volumes/...)
    // fica server-side via pino. Response NUNCA expõe err.message direto pra
    // evitar information disclosure (Sandra HIGH H-02 / OWASP A05).
    logger.error(
      { err, route: "voip.regenerate-config" },
      "Asterisk reload failed",
    );
    return NextResponse.json(
      {
        error: {
          code: "ASTERISK_RELOAD_FAILED",
          message: "Falha ao recarregar configuração do PBX. Veja os logs do servidor para detalhes.",
        },
      },
      { status: 503 }, // Service Unavailable — Asterisk pode estar offline
    );
  }
}