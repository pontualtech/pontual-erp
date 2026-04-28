// =============================================================================
// app/api/voip/extensions/route.ts
// =============================================================================
// POST /api/voip/extensions — cria ramal (gera secret server-side)
// GET  /api/voip/extensions — lista ramais
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { encryptSecret, generateSipSecret, maskSecret } from "@/lib/voip/encryption";
import { logVoipAudit } from "@/lib/voip/audit-log";
import {
  createExtensionSchema,
  listExtensionsQuerySchema,
} from "@/lib/voip/zod-schemas";
import { regenerateAsteriskConfig } from "@/lib/voip/asterisk-config-generator";

// -----------------------------------------------------------------------------
// POST /api/voip/extensions
// -----------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if (!auth.ok) return auth.response;

  const rl = await rateLimit(req, { key: "voip:extensions:create", limit: 30, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Muitas tentativas" } },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Body inválido" } },
      { status: 400 },
    );
  }

  const parsed = createExtensionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } },
      { status: 422 },
    );
  }

  const data = parsed.data;

  // Server gera o secret SIP — anti-pattern A04-03 (mass-assignment de secret weak)
  const plaintext = generateSipSecret();
  const secretEncrypted = encryptSecret(plaintext);

  try {
    const created = await prisma.voipExtension.create({
      data: {
        companyId:        data.companyId,
        number:           data.number,
        displayName:      data.displayName,
        userId:           data.userId,
        secretEncrypted,
        context:          data.context,
        tenantTag:        data.tenantTag,
        codecs:           data.codecs,
        dtmfMode:         data.dtmfMode,
        maxContacts:      data.maxContacts,
        callLimit:        data.callLimit,
        status:           data.status,
        createdBy:        auth.user.id,
        updatedBy:        auth.user.id,
      },
    });

    // Cria entry de presence inicial (offline)
    await prisma.voipPresence.create({
      data: {
        extensionId: created.id,
        companyId:   created.companyId,
        status:      "offline",
      },
    });

    await logVoipAudit({
      companyId:  created.companyId,
      userId:     auth.user.id,
      action:     "extension.created",
      entityType: "voip_extension",
      entityId:   created.id,
      diff:       { after: data }, // secret é gerado pelo server, não está em data
      request:    req,
    });

    void regenerateAsteriskConfig({
      companyId: created.companyId,
      triggeredBy: auth.user.id,
    }).catch((err) =>
      logger.error({ err: String(err) }, "voip.extensions.create.regenerate_failed"),
    );

    // Devolvemos o secret APENAS aqui — uma vez. Super admin copia pro softphone.
    return NextResponse.json(
      {
        data: {
          ...created,
          secretEncrypted: undefined,
          secret: plaintext,
          message: "Secret SIP exibido apenas nesta resposta — copie agora.",
        },
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") {
        // unique constraint (companyId, number)
        return NextResponse.json(
          {
            error: {
              code: "DUPLICATE_EXTENSION",
              message: `Ramal ${data.number} já existe nesta empresa`,
            },
          },
          { status: 409 },
        );
      }
      if (err.code === "P2003") {
        return NextResponse.json(
          { error: { code: "INVALID_REFERENCE", message: "companyId ou userId inválido" } },
          { status: 400 },
        );
      }
    }
    logger.error({ err: String(err) }, "voip.extensions.create.failed");
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "Erro interno ao criar ramal" } },
      { status: 500 },
    );
  }
}

// -----------------------------------------------------------------------------
// GET /api/voip/extensions
// -----------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const queryRaw = Object.fromEntries(url.searchParams.entries());
  const parsed = listExtensionsQuerySchema.safeParse(queryRaw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } },
      { status: 422 },
    );
  }

  const { companyId, status, userId, page, limit } = parsed.data;

  const where: Prisma.VoipExtensionWhereInput = {
    deletedAt: null,
    ...(companyId !== undefined ? { companyId } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(userId !== undefined ? { userId } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.voipExtension.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: [{ companyId: "asc" }, { number: "asc" }],
      include: {
        company:  { select: { id: true, name: true } },
        presence: true,
      },
    }),
    prisma.voipExtension.count({ where }),
  ]);

  return NextResponse.json({
    data: items.map((e) => ({
      ...e,
      secretEncrypted: undefined,
      ...maskSecret(e.secretEncrypted),
    })),
    total,
    page,
    limit,
  });
}