"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

// -----------------------------------------------------------------------------
// Types — alinhados com response do POST /api/voip/asterisk/regenerate-config
// -----------------------------------------------------------------------------

type RegenerateResponse = {
  data: {
    filesWritten: number;
    reloaded: boolean;
    providersCount: number;
    extensionsCount: number;
    regeneratedBy?: { userId: string; timestamp: string };
  };
};

type RegenerateError = {
  error: { code: string; message?: string };
};

async function postRegenerate(): Promise<RegenerateResponse> {
  const res = await fetch("/api/voip/asterisk/regenerate-config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const json = (await res.json()) as RegenerateResponse | RegenerateError;
  if (!res.ok) {
    const err = json as RegenerateError;
    const msg = err?.error?.message ?? "Falha ao regenerar configuração";
    const code = err?.error?.code ?? "UNKNOWN";
    throw new Error(`[${code}] ${msg}`);
  }
  return json as RegenerateResponse;
}

export function RegenerateConfigButton() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: postRegenerate,
    onSuccess: (data) => {
      toast.success("Configuração regenerada e Asterisk recarregado", {
        description: `${data.data.filesWritten} arquivo(s) escritos · ${data.data.providersCount} provedor(es) · ${data.data.extensionsCount} ramal(is)`,
      });
      queryClient.invalidateQueries({ queryKey: ["voip", "asterisk", "health"] });
      queryClient.invalidateQueries({ queryKey: ["voip", "asterisk", "last-regenerate"] });
      setOpen(false);
    },
    onError: (err: Error) => {
      toast.error("Falha ao regenerar configuração", {
        description: err.message,
      });
    },
  });

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        disabled={mutation.isPending}
        size="default"
      >
        {mutation.isPending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            Regenerando...
          </>
        ) : (
          <>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            Regenerar Configuração Agora
          </>
        )}
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tem certeza?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso vai recarregar todos os ramais e provedores SIP — pode interromper chamadas em
              andamento por cerca de 2 segundos. Recomendado apenas após alterações de configuração.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                mutation.mutate();
              }}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  Regenerando...
                </>
              ) : (
                "Sim, regenerar"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}