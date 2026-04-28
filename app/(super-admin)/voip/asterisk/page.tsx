"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, RefreshCw, Server, Activity, Network, Clock } from "lucide-react";
import { useUser } from "@/lib/hooks/use-user";
import { titleCase } from "@/lib/utils/title-case";
import { HealthBadge, type HealthStatus } from "./_components/health-badge";
import { RegenerateConfigButton } from "./_components/regenerate-config-button";

// -----------------------------------------------------------------------------
// Types — alinhados com response do GET /api/voip/asterisk/health (Bernardo)
// -----------------------------------------------------------------------------

type HealthResponse = {
  data: {
    reachable: boolean;
    status: number;
    asteriskVersion?: string;
    uptimeSeconds?: number;
    activeChannels?: number;
    registeredEndpoints?: number;
    totalEndpoints?: number;
    message?: string;
  };
};

type AuditLogEntry = {
  id: string;
  action: string;
  entityType: string;
  createdAt: string;
  actor: { id: string; name: string; email?: string } | null;
  diff: Record<string, unknown> | null;
};

type AuditLogResponse = {
  data: AuditLogEntry[];
};

// -----------------------------------------------------------------------------
// Fetchers
// -----------------------------------------------------------------------------

async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch("/api/voip/asterisk/health", { cache: "no-store" });
  // 503 ainda retorna JSON com data — não throw — apenas marca status como degraded/offline
  const json = (await res.json()) as HealthResponse;
  if (!res.ok && !json?.data) {
    throw new Error("Falha ao carregar healthcheck do PBX");
  }
  return json;
}

async function fetchLastRegenerate(): Promise<AuditLogResponse> {
  const params = new URLSearchParams({
    entityType: "asterisk_config",
    action: "config.regenerated",
    limit: "1",
  });
  const res = await fetch(`/api/voip/audit-log?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Falha ao carregar histórico de regeneração");
  return res.json();
}

// -----------------------------------------------------------------------------
// Helpers (locais; mover pra lib/utils se reusados)
// -----------------------------------------------------------------------------

function formatUptime(totalSeconds?: number): string {
  if (totalSeconds === undefined || totalSeconds < 0) return "—";
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

function formatRelativeBR(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `há ${Math.floor(diff)}s`;
  if (diff < 3600) return `há ${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)}h`;
  return `há ${Math.floor(diff / 86400)}d`;
}

function deriveStatus(data: HealthResponse["data"] | undefined): HealthStatus {
  if (!data) return "unknown";
  if (!data.reachable) return "offline";
  // Heuristic: ramais cadastrados mas zero registrados = degraded (provisionado mas sem cliente conectado)
  if (
    data.totalEndpoints !== undefined &&
    data.totalEndpoints > 0 &&
    data.registeredEndpoints === 0
  ) {
    return "degraded";
  }
  return "online";
}

// -----------------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------------

export default function AsteriskHealthPage() {
  const user = useUser();

  const healthQuery = useQuery({
    queryKey: ["voip", "asterisk", "health"],
    queryFn: fetchHealth,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const auditQuery = useQuery({
    queryKey: ["voip", "asterisk", "last-regenerate"],
    queryFn: fetchLastRegenerate,
    staleTime: 60_000,
  });

  // Defesa em profundidade — middleware já bloqueia. Se UI for parar aqui sem super admin, esconde.
  if (!user.isLoading && !user.isSuperAdmin) {
    return (
      <main className="p-4 md:p-8">
        <Alert variant="destructive" role="alert">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Acesso negado</AlertTitle>
          <AlertDescription>Esta área é restrita a super administradores.</AlertDescription>
        </Alert>
      </main>
    );
  }

  const status = deriveStatus(healthQuery.data?.data);
  const lastFetched = healthQuery.dataUpdatedAt
    ? new Date(healthQuery.dataUpdatedAt).toISOString()
    : null;

  return (
    <main className="space-y-6 p-4 md:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{titleCase("Asterisk PBX")}</h1>
        <p className="text-sm text-muted-foreground">
          Monitoramento e configuração do PBX self-hosted (Asterisk 20 cert release).
        </p>
      </header>

      {/* -------- Healthcheck Card (hero) -------- */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              {titleCase("Status do PBX")}
            </CardTitle>
            <CardDescription>
              Atualiza automaticamente a cada 30 segundos.
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => healthQuery.refetch()}
            disabled={healthQuery.isFetching}
            aria-label="Atualizar agora"
          >
            <RefreshCw
              className={`h-4 w-4 ${healthQuery.isFetching ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {healthQuery.isLoading && (
            <div aria-busy="true" aria-live="polite">
              <Skeleton className="h-12 w-48" />
              <Skeleton className="mt-3 h-4 w-64" />
            </div>
          )}

          {healthQuery.isError && (
            <Alert variant="destructive" role="alert">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Erro de comunicação</AlertTitle>
              <AlertDescription className="flex flex-col gap-2">
                <span>
                  {(healthQuery.error as Error)?.message ?? "Falha ao consultar healthcheck."}
                </span>
                <Button size="sm" variant="outline" onClick={() => healthQuery.refetch()}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Tentar Novamente
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {healthQuery.isSuccess && (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <HealthBadge
                  status={status}
                  variant="lg"
                  detail={healthQuery.data.data.message ?? undefined}
                />
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  <span>
                    Última verificação: {lastFetched ? formatRelativeBR(lastFetched) : "agora"}
                  </span>
                </div>
              </div>

              <Separator />

              {/* Stats grid */}
              <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatItem
                  icon={<Server className="h-4 w-4" aria-hidden="true" />}
                  label="Versão"
                  value={healthQuery.data.data.asteriskVersion ?? "—"}
                  mono
                />
                <StatItem
                  icon={<Clock className="h-4 w-4" aria-hidden="true" />}
                  label="Uptime"
                  value={formatUptime(healthQuery.data.data.uptimeSeconds)}
                />
                <StatItem
                  icon={<Activity className="h-4 w-4" aria-hidden="true" />}
                  label="Chamadas Ativas"
                  value={String(healthQuery.data.data.activeChannels ?? 0)}
                />
                <StatItem
                  icon={<Network className="h-4 w-4" aria-hidden="true" />}
                  label="Ramais Registrados"
                  value={
                    healthQuery.data.data.totalEndpoints !== undefined
                      ? `${healthQuery.data.data.registeredEndpoints ?? 0} / ${healthQuery.data.data.totalEndpoints}`
                      : String(healthQuery.data.data.registeredEndpoints ?? 0)
                  }
                />
              </dl>
            </>
          )}
        </CardContent>
      </Card>

      {/* -------- Action Card (regenerate config) -------- */}
      <Card>
        <CardHeader>
          <CardTitle>{titleCase("Regenerar Configuração")}</CardTitle>
          <CardDescription>
            Regenera os arquivos de config do Asterisk a partir do banco e recarrega os módulos
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">pjsip</code> e
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">dialplan</code>. Use após
            alterar provedor, ramal ou número.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <strong>Atenção:</strong> o reload do PJSIP pode interromper chamadas em andamento por
            cerca de 2 segundos. Evite executar em horários de pico.
          </div>

          <RegenerateConfigButton />

          {/* Last regeneration info */}
          <div className="rounded-md border p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Última Regeneração
            </p>
            {auditQuery.isLoading && <Skeleton className="mt-2 h-4 w-56" />}
            {auditQuery.isError && (
              <p className="mt-1 text-sm text-muted-foreground">
                Não foi possível carregar o histórico.
              </p>
            )}
            {auditQuery.isSuccess && auditQuery.data.data.length === 0 && (
              <p className="mt-1 text-sm text-muted-foreground">Nenhum registro ainda.</p>
            )}
            {auditQuery.isSuccess && auditQuery.data.data.length > 0 && (
              <LastRegenerateLine entry={auditQuery.data.data[0]} />
            )}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

// -----------------------------------------------------------------------------
// Sub-componentes locais
// -----------------------------------------------------------------------------

function StatItem({
  icon,
  label,
  value,
  mono = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1">
      <dt className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className={`text-lg font-semibold ${mono ? "font-mono text-base" : ""}`}>{value}</dd>
    </div>
  );
}

function LastRegenerateLine({ entry }: { entry: AuditLogEntry }) {
  const who = entry.actor?.name ?? entry.actor?.email ?? "Sistema";
  return (
    <p className="mt-1 text-sm">
      <time dateTime={entry.createdAt} className="font-medium">
        {new Date(entry.createdAt).toLocaleString("pt-BR")}
      </time>{" "}
      <span className="text-muted-foreground">({formatRelativeBR(entry.createdAt)})</span> —{" "}
      por <span className="font-medium">{who}</span>
    </p>
  );
}