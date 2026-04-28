import { Suspense } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Phone, Users, Hash, Activity } from "lucide-react";
import { requireSuperAdmin } from "@/lib/auth/require-super-admin";
import { prisma } from "@/lib/prisma";
import { titleCase } from "@/lib/utils/title-case";

export const metadata = {
  title: "Telefonia | Super Admin",
};

async function VoipOverviewCards() {
  // Server Component lê do banco diretamente — não precisa de fetch interno HTTP
  // (fetch interno com cookie: "" perdia a sessão e quebrava requireSuperAdmin nos handlers)
  const [providersTotal, extensionsTotal, inboundTotal, health] = await Promise.all([
    prisma.voipProvider.count({ where: { deletedAt: null } }),
    prisma.voipExtension.count({ where: { deletedAt: null } }),
    prisma.voipInboundNumber.count({ where: { deletedAt: null } }),
    // Healthcheck Asterisk: endpoint EXTERNO (não é route handler interno) — fetch é OK aqui
    fetch(`${process.env.ASTERISK_HEALTH_URL ?? "http://asterisk:8088/health"}`, {
      cache: "no-store",
      // timeout curto pra não travar a página se PBX caiu
      signal: AbortSignal.timeout(2000),
    })
      .then((r) => (r.ok ? r.json() : { status: "unknown" }))
      .catch(() => ({ status: "unknown" })),
  ]);

  const cards = [
    {
      title: "Provedores SIP",
      value: providersTotal,
      description: "Trunks cadastrados (Sonax e outros)",
      href: "/super-admin/voip/providers",
      icon: Phone,
    },
    {
      title: "Ramais",
      value: extensionsTotal,
      description: "Faixa permitida na Fase 1: 100-109",
      href: "/super-admin/voip/extensions",
      icon: Users,
    },
    {
      title: "Números (DIDs)",
      value: inboundTotal,
      description: "Números de entrada vinculados a provedor",
      href: "/super-admin/voip/inbound-numbers",
      icon: Hash,
    },
    {
      title: "Status do PBX",
      value: health.status === "ok" ? "Online" : "Offline",
      description: "Asterisk 20 (host network)",
      href: "/super-admin/voip/asterisk",
      icon: Activity,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <Link key={c.title} href={c.href} className="block transition hover:opacity-90">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{c.title}</CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{c.value}</div>
                <p className="text-xs text-muted-foreground">{c.description}</p>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="pb-2">
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-16" />
            <Skeleton className="mt-2 h-3 w-40" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default async function VoipOverviewPage() {
  await requireSuperAdmin();

  return (
    <main className="space-y-6 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{titleCase("Telefonia")}</h1>
        <p className="text-sm text-muted-foreground">
          Configuração do PBX self-hosted (Asterisk 20) — Fase 1: provedor SIP, ramais e números.
        </p>
      </header>

      <Suspense fallback={<OverviewSkeleton />}>
        {/* @ts-expect-error Async Server Component */}
        <VoipOverviewCards />
      </Suspense>

      <section aria-labelledby="quick-actions" className="space-y-3">
        <h2 id="quick-actions" className="text-lg font-semibold">{titleCase("Ações Rápidas")}</h2>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="default">
            <Link href="/super-admin/voip/providers">Gerenciar Provedores</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/super-admin/voip/extensions">Gerenciar Ramais</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/super-admin/voip/inbound-numbers">Gerenciar Números</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}