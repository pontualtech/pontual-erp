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
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { AlertTriangle, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { ProviderForm } from "../_components/provider-form";
import { titleCase } from "@/lib/utils/title-case";

type Provider = {
  id: string;
  companyId: string;
  companyName?: string;
  name: string;
  hostOutbound: string;
  hostInbound: string | null;
  port: number;
  transport: "udp" | "tcp" | "tls";
  authMethod: "IP_BASED" | "USER_SECRET";
  username: string | null;
  matchIp: string | null;
  hasSecret: boolean;
  codecs: string[];
  dtmfMode: string;
  contextInbound: string;
  isActive: boolean;
  createdAt: string;
};

type ProviderListResponse = {
  data: Provider[];
  total: number;
  page: number;
  limit: number;
};

async function fetchProviders(search: string): Promise<ProviderListResponse> {
  const params = new URLSearchParams();
  if (search) params.set("q", search);
  params.set("limit", "50");
  const res = await fetch(`/api/voip/providers?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Falha ao carregar provedores");
  return res.json();
}

export default function ProvidersListPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Provider | null>(null);

  const query = useQuery({
    queryKey: ["voip", "providers", search],
    queryFn: () => fetchProviders(search),
    staleTime: 30_000,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/voip/providers/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? "Falha ao excluir provedor");
      }
    },
    onSuccess: () => {
      toast.success("Provedor removido");
      queryClient.invalidateQueries({ queryKey: ["voip", "providers"] });
      setConfirmDelete(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const openNew = () => {
    setEditing(null);
    setSheetOpen(true);
  };

  const openEdit = (provider: Provider) => {
    setEditing(provider);
    setSheetOpen(true);
  };

  return (
    <main className="space-y-4 p-4 md:p-8">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{titleCase("Provedores SIP")}</h1>
          <p className="text-sm text-muted-foreground">
            Trunks cadastrados (Sonax e outros). A senha nunca é exibida em texto claro.
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          Novo Provedor
        </Button>
      </header>

      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <Input
          type="search"
          placeholder="Buscar por nome ou empresa…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="md:max-w-md"
          aria-label="Buscar provedor"
        />
      </div>

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
          <AlertTitle>Erro ao carregar provedores</AlertTitle>
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
            <p className="text-sm text-muted-foreground">Nenhum provedor cadastrado ainda.</p>
            <Button onClick={openNew}>
              <Plus className="mr-2 h-4 w-4" /> Cadastrar Primeiro Provedor
            </Button>
          </CardContent>
        </Card>
      )}

      {query.isSuccess && query.data.data.length > 0 && (
        <>
          {/* Desktop: Table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Host (Saída)</TableHead>
                  <TableHead>Auth</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.data.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{p.companyName ?? p.companyId.slice(0, 8)}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {p.hostOutbound}:{p.port} / {p.transport.toUpperCase()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.authMethod === "IP_BASED" ? "secondary" : "outline"}>
                        {p.authMethod === "IP_BASED" ? "IP" : "User/Senha"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.isActive ? "default" : "outline"}>
                        {p.isActive ? "Ativo" : "Inativo"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(p)} aria-label="Editar">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setConfirmDelete(p)}
                        aria-label="Excluir"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: Card stack */}
          <div className="space-y-3 md:hidden">
            {query.data.data.map((p) => (
              <Card key={p.id}>
                <CardContent className="space-y-2 py-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{p.companyName ?? p.companyId.slice(0, 8)}</p>
                    </div>
                    <Badge variant={p.isActive ? "default" : "outline"}>
                      {p.isActive ? "Ativo" : "Inativo"}
                    </Badge>
                  </div>
                  <p className="font-mono text-xs">{p.hostOutbound}:{p.port}</p>
                  <p className="text-xs">
                    Auth: {p.authMethod === "IP_BASED" ? "IP" : "User/Senha"}
                  </p>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => openEdit(p)}>
                      <Pencil className="mr-1 h-3 w-3" /> Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => setConfirmDelete(p)}
                    >
                      <Trash2 className="mr-1 h-3 w-3" /> Excluir
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
            <SheetTitle>{editing ? "Editar Provedor" : "Novo Provedor SIP"}</SheetTitle>
            <SheetDescription>
              {editing
                ? "Edição não permite trocar empresa. Senha é re-criptografada se preenchida."
                : "Cadastre um novo trunk SIP. Para Sonax, use IP_BASED autorizando o IP da VPS."}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            <ProviderForm
              initial={editing}
              onSuccess={() => {
                setSheetOpen(false);
                queryClient.invalidateQueries({ queryKey: ["voip", "providers"] });
              }}
            />
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Provedor?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação fará soft-delete do provedor <strong>{confirmDelete?.name}</strong>.
              Não é possível excluir provedores com ramais ativos vinculados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (confirmDelete) deleteMutation.mutate(confirmDelete.id);
              }}
            >
              {deleteMutation.isPending ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}