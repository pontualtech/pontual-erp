// =============================================================================
// lib/voip/ari-client.ts
// =============================================================================
// Wrapper HTTP para Asterisk REST Interface (ARI).
// Usado para healthcheck e module reload (regenerate config).
// Bind do ARI no Asterisk: 127.0.0.1:8088 (host network) — só Next.js
// no mesmo host acessa.
// =============================================================================

import { logger } from "@/lib/logger";

const ARI_BASE_URL = process.env.ARI_BASE_URL ?? "http://127.0.0.1:8088/ari";
const ARI_USER = process.env.ARI_USER ?? "erp";
const ARI_PASSWORD = process.env.ARI_PASSWORD;

if (!ARI_PASSWORD && process.env.NODE_ENV === "production") {
  // Não dá throw em dev (módulo importado em testes), mas avisa em prod.
  logger.warn("ari-client: ARI_PASSWORD não definida — chamadas vão falhar em runtime");
}

function basicAuthHeader(): string {
  const pwd = ARI_PASSWORD ?? "";
  return "Basic " + Buffer.from(`${ARI_USER}:${pwd}`).toString("base64");
}

interface AriRequestOpts {
  method?: "GET" | "POST" | "DELETE" | "PUT";
  path: string;
  body?: unknown;
  timeoutMs?: number;
}

async function ariRequest(opts: AriRequestOpts): Promise<Response> {
  const { method = "GET", path, body, timeoutMs = 5000 } = opts;
  const url = `${ARI_BASE_URL}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: basicAuthHeader(),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export interface AriHealthResponse {
  reachable: boolean;
  status: number | null;
  asteriskVersion?: string;
  systemUptime?: number;
  errorMessage?: string;
}

/**
 * GET /asterisk/info — healthcheck.
 * Retorna { reachable, status, asteriskVersion } — usado pelo endpoint
 * /api/voip/asterisk/health.
 */
export async function ariHealthcheck(): Promise<AriHealthResponse> {
  try {
    const res = await ariRequest({ method: "GET", path: "/asterisk/info", timeoutMs: 3000 });
    if (!res.ok) {
      return {
        reachable: false,
        status: res.status,
        errorMessage: `ARI respondeu com status ${res.status}`,
      };
    }
    const data = (await res.json()) as {
      build?: { kernel?: string };
      system?: { version?: string };
      status?: { startup_time?: string };
    };
    return {
      reachable: true,
      status: 200,
      asteriskVersion: data.system?.version ?? data.build?.kernel,
    };
  } catch (err) {
    return {
      reachable: false,
      status: null,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Reload de módulo do Asterisk via ARI.
 * Usado após escrever pjsip.conf / extensions.conf.
 *
 * @param moduleName ex: "res_pjsip.so", "pbx_config.so"
 */
export async function ariModuleReload(moduleName: string): Promise<void> {
  const res = await ariRequest({
    method: "PUT",
    path: `/asterisk/modules/${encodeURIComponent(moduleName)}`,
    timeoutMs: 10000,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ariModuleReload(${moduleName}): status ${res.status} ${text}`);
  }
}

/**
 * Reload de pjsip + extensions de uma vez (ordem importa).
 * Esta é a chamada padrão pós-regenerate-config.
 */
export async function ariReloadVoipConfig(): Promise<void> {
  // pjsip primeiro (carrega endpoints), depois pbx_config (extensions.conf).
  await ariModuleReload("res_pjsip.so");
  await ariModuleReload("pbx_config.so");
}

/**
 * Verifica que ARI está acessível com auth válida.
 * Usado em smoke test pós-deploy.
 */
export async function ariAuthCheck(): Promise<boolean> {
  try {
    const res = await ariRequest({ method: "GET", path: "/asterisk/info", timeoutMs: 3000 });
    return res.status !== 401;
  } catch {
    return false;
  }
}