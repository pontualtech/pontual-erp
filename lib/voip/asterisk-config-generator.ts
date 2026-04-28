// =============================================================================
// lib/voip/asterisk-config-generator.ts
// =============================================================================
// Lê voip_providers + voip_extensions do DB, decripta secrets em runtime,
// renderiza templates Mustache, escreve em /etc/asterisk via volume montado,
// e dispara reload via ARI.
//
// Atomicidade: usa write-then-rename para evitar Asterisk lendo arquivo parcial.
// Idempotência: rerun com mesmo input do DB gera output byte-equal (modulo
// timestamp do header — comentário {{generatedAt}}).
// =============================================================================

import path from "path";
import { promises as fs } from "fs";
import Mustache from "mustache";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { decryptSecret } from "./encryption";
import { ariReloadVoipConfig } from "./ari-client";
import { logVoipAudit } from "./audit-log";

// Path do volume montado em /etc/asterisk dentro do container.
// Em produção: definido via env (host bind path absoluto, escolhido pelo Otávio em step-14).
const ASTERISK_CONFIG_DIR = process.env.ASTERISK_CONFIG_DIR ?? "/var/lib/coolify/volumes/pontualtech-asterisk-config/_data";
const TEMPLATES_DIR       = path.join(process.cwd(), "infra/asterisk/templates");

interface GenerateOpts {
  companyId?: string;        // se setado, gera apenas para 1 tenant
  triggeredBy: string | null; // userId que disparou (pra audit)
  reload?: boolean;          // default true; false = só escreve arquivos
}

interface RenderContext {
  generatedAt: string;
  providers: ProviderTemplateCtx[];
  extensions: ExtensionTemplateCtx[];
  tenants: TenantTemplateCtx[];
  ariPassword: string;
}

interface ProviderTemplateCtx {
  name: string;
  companyName: string;
  tenantTag: string;
  transport: string;
  port: number;
  qualifyFrequency: number;
  hostOutbound: string;
  contextInbound: string;
  dtmfMode: string;
  codecs: string[];
  matchIp: string | null;
  username: string | null;
  secretPlain: string | null;
  isIpBased: boolean;
  isUserSecret: boolean;
}

interface ExtensionTemplateCtx {
  number: string;
  context: string;
  tenantTag: string;
  maxContacts: number;
  codecs: string[];
  dtmfMode: string;
  callLimit: number | null;
  secretPlain: string;
}

interface TenantTemplateCtx {
  tenantTag: string;
}

// -----------------------------------------------------------------------------
// Public entrypoint
// -----------------------------------------------------------------------------

export async function regenerateAsteriskConfig(opts: GenerateOpts): Promise<{
  filesWritten: string[];
  reloaded: boolean;
  providersCount: number;
  extensionsCount: number;
}> {
  const { companyId, triggeredBy, reload = true } = opts;

  logger.info({ companyId, triggeredBy }, "voip.config.regenerate.start");

  // 1) Buscar dados — explicitly filter companyId se fornecido (anti-pattern B.1)
  const providerWhere = {
    isActive: true,
    deletedAt: null,
    ...(companyId ? { companyId } : {}),
  };
  const extensionWhere = {
    status: "ACTIVE" as const,
    deletedAt: null,
    ...(companyId ? { companyId } : {}),
  };

  const [providers, extensions] = await Promise.all([
    prisma.voipProvider.findMany({
      where: providerWhere,
      include: { company: { select: { id: true, name: true } } },
    }),
    prisma.voipExtension.findMany({
      where: extensionWhere,
    }),
  ]);

  // 2) Decriptar secrets em memória — NUNCA logar
  const providersCtx: ProviderTemplateCtx[] = providers.map((p) => ({
    name:             p.name,
    companyName:      p.company.name,
    tenantTag:        slugify(p.company.name) + "-" + p.id.substring(0, 8),
    transport:        p.transport,
    port:             p.port,
    qualifyFrequency: p.qualifyFrequency,
    hostOutbound:     p.hostOutbound,
    contextInbound:   p.contextInbound,
    dtmfMode:         p.dtmfMode,
    codecs:           p.codecs,
    matchIp:          p.matchIp,
    username:         p.username,
    secretPlain:      p.secretEncrypted ? decryptSecret(p.secretEncrypted) : null,
    isIpBased:        p.authMethod === "IP_BASED",
    isUserSecret:     p.authMethod === "USER_SECRET",
  }));

  const extensionsCtx: ExtensionTemplateCtx[] = extensions.map((e) => ({
    number:      e.number,
    context:     e.context,
    tenantTag:   e.tenantTag,
    maxContacts: e.maxContacts,
    codecs:      e.codecs,
    dtmfMode:    e.dtmfMode,
    callLimit:   e.callLimit,
    secretPlain: decryptSecret(e.secretEncrypted),
  }));

  // 3) Tenants únicos a partir de providers + extensions
  const tenantSet = new Set<string>();
  for (const p of providersCtx) tenantSet.add(p.tenantTag);
  for (const e of extensionsCtx) tenantSet.add(e.tenantTag);
  const tenants: TenantTemplateCtx[] = Array.from(tenantSet).map((t) => ({ tenantTag: t }));

  // 4) Render templates
  const ariPassword = process.env.ARI_PASSWORD ?? "";
  if (!ariPassword) {
    throw new Error("regenerateAsteriskConfig: ARI_PASSWORD não setado no env");
  }

  const ctx: RenderContext = {
    generatedAt: new Date().toISOString(),
    providers:   providersCtx,
    extensions:  extensionsCtx,
    tenants,
    ariPassword,
  };

  const filesToWrite: Array<{ name: string; content: string }> = [
    { name: "pjsip.conf",      content: await renderTemplate("pjsip.conf.tmpl",      ctx) },
    { name: "extensions.conf", content: await renderTemplate("extensions.conf.tmpl", ctx) },
    { name: "ari.conf",        content: await renderTemplate("ari.conf.tmpl",        ctx) },
    { name: "http.conf",       content: await renderTemplate("http.conf.tmpl",       ctx) },
    { name: "manager.conf",    content: await renderTemplate("manager.conf.tmpl",    ctx) },
  ];

  // 5) Atomic write — escreve .tmp e renomeia
  await fs.mkdir(ASTERISK_CONFIG_DIR, { recursive: true });
  const written: string[] = [];
  for (const f of filesToWrite) {
    const finalPath = path.join(ASTERISK_CONFIG_DIR, f.name);
    const tmpPath   = `${finalPath}.tmp.${process.pid}`;
    await fs.writeFile(tmpPath, f.content, { mode: 0o640 });
    await fs.rename(tmpPath, finalPath);
    written.push(finalPath);
  }

  // 6) Reload via ARI (opcional)
  let reloaded = false;
  if (reload) {
    try {
      await ariReloadVoipConfig();
      reloaded = true;
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        "voip.config.reload.failed",
      );
      // Não joga erro — arquivos foram escritos com sucesso, reload é best-effort.
    }
  }

  // 7) Audit
  await logVoipAudit({
    companyId: companyId ?? "system",
    userId: triggeredBy,
    action: "config.regenerated",
    entityType: "asterisk_config",
    entityId: null,
    diff: {
      after: {
        providers: providers.length,
        extensions: extensions.length,
        tenants: tenants.length,
        reloaded,
      },
    },
  });

  logger.info(
    {
      companyId,
      triggeredBy,
      providersCount: providers.length,
      extensionsCount: extensions.length,
      reloaded,
    },
    "voip.config.regenerate.done",
  );

  return {
    filesWritten: written,
    reloaded,
    providersCount: providers.length,
    extensionsCount: extensions.length,
  };
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

async function renderTemplate(filename: string, ctx: RenderContext): Promise<string> {
  const tmplPath = path.join(TEMPLATES_DIR, filename);
  const tmpl = await fs.readFile(tmplPath, "utf-8");
  // Mustache interpreta {{#section}} / {{^section}} (inverted) / {{#each}} (NÃO suportado).
  // Usamos o mecanismo nativo: {{#providers}}...{{/providers}} itera array.
  return Mustache.render(tmpl, ctx);
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")  // remove acentos
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}