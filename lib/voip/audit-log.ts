// =============================================================================
// lib/voip/audit-log.ts
// =============================================================================
// Helper para inserir entradas em voip_audit_log de forma consistente.
// Toda mutation (POST/PUT/DELETE) chama logVoipAudit() — anti-pattern A09-03.
// Diff NUNCA contém secrets em claro (validado em redactDiff).
// =============================================================================

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * Campos sensíveis que JAMAIS aparecem em diff (audit log).
 * Match-all (case-insensitive substring).
 */
const SENSITIVE_FIELDS = [
  "secret",
  "secretEncrypted",
  "password",
  "token",
  "apiKey",
  "api_key",
];

/**
 * Remove valores sensíveis de um objeto antes de persistir em audit_log.
 * Recursivo — funciona em objetos aninhados.
 */
export function redactDiff<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    return obj.map((v) => redactDiff(v)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const lower = k.toLowerCase();
    if (SENSITIVE_FIELDS.some((s) => lower.includes(s.toLowerCase()))) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = redactDiff(v);
    }
  }
  return out as T;
}

export interface VoipAuditPayload {
  companyId: string;
  userId: string | null;
  action: string;             // ex: "provider.created", "extension.regen-secret"
  entityType: string;         // ex: "voip_provider"
  entityId: string | null;
  diff?: { before?: unknown; after?: unknown } | null;
  request?: NextRequest;      // opcional, extrai IP / UA
}

/**
 * Insere entrada em voip_audit_log.
 * Falha de log NÃO derruba a operação — log de aviso e segue (best-effort).
 */
export async function logVoipAudit(payload: VoipAuditPayload): Promise<void> {
  const { companyId, userId, action, entityType, entityId, diff, request } = payload;

  try {
    // X-Forwarded-For é uma chain: "client, proxy1, proxy2, nosso_proxy".
    // O cliente controla os primeiros valores (qualquer atacante pode setar
    // X-Forwarded-For: 1.2.3.4 antes de bater no nosso edge), portanto pegar
    // o PRIMEIRO valor permite IP spoof no audit log (Sandra HIGH H-01 / OWASP A09).
    // O ÚLTIMO valor é o que o nosso proxy de confiança (Coolify/Traefik) anexou,
    // logo é o único confiável. NÃO "consertar" pra [0] sem revisar threat model.
    const xff = request?.headers.get("x-forwarded-for");
    const ipAddress = xff
      ? xff.split(",").map((s) => s.trim()).pop()
        ?? request?.headers.get("x-real-ip")
        ?? null
      : request?.headers.get("x-real-ip") ?? null;
    const userAgent = request?.headers.get("user-agent") ?? null;

    const safeDiff = diff
      ? {
          before: diff.before !== undefined ? redactDiff(diff.before) : undefined,
          after:  diff.after  !== undefined ? redactDiff(diff.after)  : undefined,
        }
      : null;

    await prisma.voipAuditLog.create({
      data: {
        companyId,
        userId,
        action,
        entityType,
        entityId,
        diff: safeDiff as never,
        ipAddress,
        userAgent,
      },
    });
  } catch (err) {
    // Best-effort: log mas não trava o request principal.
    logger.warn(
      { action, entityType, entityId, err: err instanceof Error ? err.message : String(err) },
      "voip.audit_log.write_failed",
    );
  }
}