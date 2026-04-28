"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { AlertTriangle, Copy, Key, Pencil, Plus, RefreshCw } from "lucide-react";
import { ExtensionForm } from "../_components/extension-form";
import { titleCase } from "@/lib/utils/title-case";

type Extension = {
  id: string;
  companyId: string;
  companyName?: string;
  number: string;
  displayName: string;
  userId: string | null;
  userName: string | null;
  context: string;
  tenantTag: string;
  status: "ACTIVE" | "DISABLED" | "PROVISIONING";
  maxContacts: number;
  callLimit: number | null;
  hasSecret: boolean;
  createdAt: string;
};

type ExtensionListResponse = {
  data: Extension[];
  total: number;
  page: number;
  limit: number;
};

const STATUS_LABEL: Record<Extension["status"], string> = {
  ACTIVE: "Ativo",
  DISABLED: "Desativado",
  PROVISIONING: "Provisionando",
};

const STATUS_VARIANT: Record<Extension["status"], "default" | "outline" | "secondary"> = {
  ACTIVE: "default",
  DISABLED: "outline",
  PROVISIONING: "secondary",
};

async function fetchExtensions(search: string): Promise<ExtensionListResponse> {
  const params = new URLSearchParams();
  if (search) params.set("q", search);
  params.set("limit", "50");
  const res = await fetch(`/api/voip/extensions?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Falha ao carregar ramais");
  return res.json();
}

export default function ExtensionsListPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Extension | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<{ number: string; secret: string } | null>(null);

  const query = useQuery({
    queryKey: ["voip", "extensions", search],
    queryFn: () => fetchExtensions(search),
    staleTime: 30_000,
  });

  const regenMutation = useMutation({
    mutationFn: async (ext: Extension): Promise<{ secret: string }> => {
      const res = await fetch(`/api/voip/extensions/${ext.id}/regen-secret`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? "Falha ao regenerar secret");
      }
      return res.json();
    },
    onSuccess: (data, ext) => {
      setRevealedSecret({ number: ext.number, secret: data.secret });
      queryClient.invalidateQueries({ queryKey: ["voip", "extensions"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const copySecret = async () => {
    if (!revealedSecret) return;
    try {
      await navigator.clipboard.writeText(revealedSecret.secret);
      toast.success("Secret copiado para a área de transferência");
    } catch {
      toast.error("Não foi possível copiar — copie manualmente");
    }
  };

  return (
    <main className="space-y-4 p-4 md:p-8">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{titleCase("Ramais SIP")}</h1>
          <p className="text-sm text-muted-foreground">
            Faixa permitida na Fase 1: <strong>100 a 109</strong>. A senha do ramal é gerada pelo servidor e exibida apenas uma vez.
          </p>
        </div>
        <Button onClick={() => { setEditing(null); setSheetOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          Novo Ramal
        </Button>
      </header>

      <Input
        type="search"
        placeholder="Buscar por número, nome ou empresa…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="md:max-w-md"
        aria-label="Buscar ramal"
      />

      {query.isLoading && (
        <div className="space-y-2" aria-busy="true" aria-live="polite">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {query.isError && (
        <Alert variant="destructive" role="alert">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Erro ao carregar ramais</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>{(query.error as Error)?.message ?? "Tente novamente em alguns segundos."}</span>
            <div>
              <Button size="sm" variant="outline" onClick={() => query.refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" /> Tentar Novamente
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {query.isSuccess && query.data.data.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">Nenhum ramal cadastrado ainda.</p>
            <Button onClick={() => { setEditing(null); setSheetOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" /> Cadastrar Primeiro Ramal
            </Button>
          </CardContent>
        </Card>
      )}

      {query.isSuccess && query.data.data.length > 0 && (
        <>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Número</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.data.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-mono font-semibold">{e.number}</TableCell>
                    <TableCell>{e.displayName}</TableCell>
                    <TableCell className="text-xs">{e.companyName ?? e.companyId.slice(0, 8)}</TableCell>
                    <TableCell className="text-xs">{e.userName ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[e.status]}>{STATUS_LABEL[e.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="icon" variant="ghost" onClick={() => { setEditing(e); setSheetOpen(true); }} aria-label="Editar">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => regenMutation.mutate(e)}
                        disabled={regenMutation.isPending}
                        aria-label="Regenerar secret"
                      >
                        <Key className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-3 md:hidden">
            {query.data.data.map((e) => (
              <Card key={e.id}>
                <CardContent className="space-y-2 py-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-mono text-lg font-bold">{e.number}</p>
                      <p className="text-sm">{e.displayName}</p>
                      <p className="text-xs text-muted-foreground">{e.companyName ?? e.companyId.slice(0, 8)}</p>
                    </div>
                    <Badge variant={STATUS_VARIANT[e.status]}>{STATUS_LABEL[e.status]}</Badge>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => { setEditing(e); setSheetOpen(true); }}>
                      <Pencil className="mr-1 h-3 w-3" /> Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => regenMutation.mutate(e)}
                      disabled={regenMutation.isPending}
                    >
                      <Key className="mr-1 h-3 w-3" /> Regenerar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>{editing ? "Editar Ramal" : "Novo Ramal SIP"}</SheetTitle>
            <SheetDescription>
              {editing
                ? "Edição não permite trocar número nem empresa."
                : "Número e empresa são imutáveis após criação. Faixa válida na Fase 1: 100-109."}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            <ExtensionForm
              initial={editing}
              onSuccess={(secret) => {
                setSheetOpen(false);
                queryClient.invalidateQueries({ queryKey: ["voip", "extensions"] });
                if (secret && !editing) {
                  // No create flow, server returns the secret one-time
                  setRevealedSecret({ number: "novo ramal", secret });
                }
              }}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={!!revealedSecret} onOpenChange={(o) => !o && setRevealedSecret(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Senha SIP do Ramal {revealedSecret?.number}</DialogTitle>
            <DialogDescription>
              <strong>Atenção:</strong> esta senha será exibida apenas <strong>uma vez</strong>.
              Salve-a agora em um local seguro — após fechar este diálogo, não há como recuperá-la
              (será necessário gerar uma nova).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <code className="block break-all rounded border bg-muted p-3 font-mono text-sm">
              {revealedSecret?.secret}
            </code>
          </div>
          <DialogFooter className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={copySecret}>
              <Copy className="mr-2 h-4 w-4" /> Copiar
            </Button>
            <Button onClick={() => setRevealedSecret(null)}>Já Salvei, Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}