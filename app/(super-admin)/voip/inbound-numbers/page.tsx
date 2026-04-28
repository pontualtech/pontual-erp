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
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { AlertTriangle, Plus, RefreshCw, Trash2 } from "lucide-react";
import { InboundNumberForm } from "../_components/inbound-number-form";
import { titleCase } from "@/lib/utils/title-case";

type InboundNumber = {
  id: string;
  companyId: string;
  companyName?: string;
  providerId: string;
  providerName: string;
  ddd: string;
  number: string;
  e164: string;
  label: string;
  isActive: boolean;
  createdAt: string;
};

type InboundListResponse = {
  data: InboundNumber[];
  total: number;
  page: number;
  limit: number;
};

function formatE164ToDisplay(e164: string): string {
  // +551126263841 -> +55 (11) 2626-3841
  const m = e164.match(/^\+(\d{2})(\d{2})(\d{4,5})(\d{4})$/);
  if (!m) return e164;
  return `+${m[1]} (${m[2]}) ${m[3]}-${m[4]}`;
}

async function fetchInbound(search: string): Promise<InboundListResponse> {
  const params = new URLSearchParams();
  if (search) params.set("q", search);
  params.set("limit", "50");
  const res = await fetch(`/api/voip/inbound-numbers?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Falha ao carregar números");
  return res.json();
}

export default function InboundNumbersListPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<InboundNumber | null>(null);

  const query = useQuery({
    queryKey: ["voip", "inbound", search],
    queryFn: () => fetchInbound(search),
    staleTime: 30_000,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/voip/inbound-numbers/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? "Falha ao remover número");
      }
    },
    onSuccess: () => {
      toast.success("Número removido");
      queryClient.invalidateQueries({ queryKey: ["voip", "inbound"] });
      setConfirmDelete(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <main className="space-y-4 p-4 md:p-8">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{titleCase("Números de Entrada (DIDs)")}</h1>
          <p className="text-sm text-muted-foreground">
            Números brasileiros recebidos de provedores SIP. Na Fase 1 são apenas cadastrados — o roteamento de chamadas externas vem na Fase 2.
          </p>
        </div>
        <Button onClick={() => setSheetOpen(true)}>
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          Novo Número
        </Button>
      </header>

      <Input
        type="search"
        placeholder="Buscar por número, rótulo ou empresa…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="md:max-w-md"
        aria-label="Buscar número"
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
          <AlertTitle>Erro ao carregar números</AlertTitle>
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
            <p className="text-sm text-muted-foreground">Nenhum número cadastrado ainda.</p>
            <Button onClick={() => setSheetOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Cadastrar Primeiro Número
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
                  <TableHead>Número (E.164)</TableHead>
                  <TableHead>Rótulo</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Provedor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.data.map((n) => (
                  <TableRow key={n.id}>
                    <TableCell className="font-mono">{formatE164ToDisplay(n.e164)}</TableCell>
                    <TableCell>{n.label}</TableCell>
                    <TableCell className="text-xs">{n.companyName ?? n.companyId.slice(0, 8)}</TableCell>
                    <TableCell className="text-xs">{n.providerName}</TableCell>
                    <TableCell>
                      <Badge variant={n.isActive ? "default" : "outline"}>
                        {n.isActive ? "Ativo" : "Inativo"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setConfirmDelete(n)}
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

          <div className="space-y-3 md:hidden">
            {query.data.data.map((n) => (
              <Card key={n.id}>
                <CardContent className="space-y-2 py-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-mono text-sm font-semibold">{formatE164ToDisplay(n.e164)}</p>
                      <p className="text-sm">{n.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {(n.companyName ?? n.companyId.slice(0, 8))} • {n.providerName}
                      </p>
                    </div>
                    <Badge variant={n.isActive ? "default" : "outline"}>
                      {n.isActive ? "Ativo" : "Inativo"}
                    </Badge>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => setConfirmDelete(n)}
                  >
                    <Trash2 className="mr-1 h-3 w-3" /> Excluir
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>Novo Número (DID)</SheetTitle>
            <SheetDescription>
              Cadastre um número brasileiro para uma empresa. Cada DID é único globalmente.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            <InboundNumberForm
              onSuccess={() => {
                setSheetOpen(false);
                queryClient.invalidateQueries({ queryKey: ["voip", "inbound"] });
              }}
            />
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Número?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação removerá definitivamente o número{" "}
              <strong className="font-mono">{confirmDelete && formatE164ToDisplay(confirmDelete.e164)}</strong>.
              Após excluído, o DID pode ser cadastrado novamente para qualquer empresa.
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