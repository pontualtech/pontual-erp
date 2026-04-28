"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { createInboundNumberSchema } from "@/lib/voip/zod-schemas";

type FormValues = z.infer<typeof createInboundNumberSchema>;

type Company = { id: string; name: string };
type Provider = { id: string; name: string; companyId: string };

interface InboundNumberFormProps {
  onSuccess: () => void;
}

/**
 * Mask formatter for Brazilian phone numbers.
 * Accepts user input "1126263841" or "+55 (11) 2626-3841" and normalizes to E.164.
 * Returns { ddd, number } extracted, or null if invalid.
 */
function parseBrazilianPhone(raw: string): { ddd: string; number: string } | null {
  const digits = raw.replace(/\D/g, "").replace(/^55/, "");
  if (digits.length !== 10 && digits.length !== 11) return null;
  const ddd = digits.slice(0, 2);
  const number = digits.slice(2);
  return { ddd, number };
}

function formatAsTyping(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^55/, "").slice(0, 11);
  if (digits.length === 0) return "";
  if (digits.length <= 2) return `+55 (${digits}`;
  if (digits.length <= 6) return `+55 (${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `+55 (${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `+55 (${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export function InboundNumberForm({ onSuccess }: InboundNumberFormProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(createInboundNumberSchema),
    defaultValues: {
      companyId: "",
      providerId: "",
      ddd: "",
      number: "",
      label: "",
    },
  });

  const selectedCompanyId = form.watch("companyId");

  const companiesQuery = useQuery<{ data: Company[] }>({
    queryKey: ["super-admin", "companies"],
    queryFn: async () => {
      const res = await fetch("/api/super-admin/companies?limit=200");
      if (!res.ok) throw new Error("Falha ao carregar empresas");
      return res.json();
    },
    staleTime: 60_000,
  });

  const providersQuery = useQuery<{ data: Provider[] }>({
    queryKey: ["voip", "providers", "by-company", selectedCompanyId],
    queryFn: async () => {
      const res = await fetch(`/api/voip/providers?companyId=${selectedCompanyId}&isActive=true&limit=100`);
      if (!res.ok) throw new Error("Falha ao carregar provedores");
      return res.json();
    },
    enabled: !!selectedCompanyId,
    staleTime: 30_000,
  });

  const submitMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const res = await fetch("/api/voip/inbound-numbers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw { httpError: true, body: err };
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Número cadastrado");
      onSuccess();
    },
    onError: (err: { httpError?: boolean; body?: { error?: string; details?: Record<string, string[]> } }) => {
      if (err?.body?.details) {
        for (const [field, messages] of Object.entries(err.body.details)) {
          form.setError(field as keyof FormValues, {
            type: "server",
            message: Array.isArray(messages) ? messages[0] : String(messages),
          });
        }
      }
      toast.error(err?.body?.error ?? "Falha ao cadastrar número");
    },
  });

  const onSubmit = (values: FormValues) => submitMutation.mutate(values);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
        <FormField
          control={form.control}
          name="companyId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Empresa</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger aria-label="Empresa">
                    <SelectValue placeholder="Selecione a empresa" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {companiesQuery.data?.data.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="providerId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Provedor SIP</FormLabel>
              <Select
                onValueChange={field.onChange}
                value={field.value}
                disabled={!selectedCompanyId}
              >
                <FormControl>
                  <SelectTrigger aria-label="Provedor SIP">
                    <SelectValue placeholder={selectedCompanyId ? "Selecione o provedor" : "Selecione a empresa primeiro"} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {providersQuery.data?.data.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>
                Apenas provedores ativos da empresa selecionada são exibidos.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormItem>
          <FormLabel>Número (formato brasileiro)</FormLabel>
          <FormControl>
            <Input
              type="tel"
              inputMode="numeric"
              placeholder="+55 (11) 2626-3841"
              onChange={(e) => {
                const formatted = formatAsTyping(e.target.value);
                e.target.value = formatted;
                const parsed = parseBrazilianPhone(formatted);
                if (parsed) {
                  form.setValue("ddd", parsed.ddd, { shouldValidate: true });
                  form.setValue("number", parsed.number, { shouldValidate: true });
                } else {
                  form.setValue("ddd", "", { shouldValidate: true });
                  form.setValue("number", "", { shouldValidate: true });
                }
              }}
              aria-describedby="phone-help"
            />
          </FormControl>
          <FormDescription id="phone-help">
            Formatos aceitos: <code>+55 (11) 2626-3841</code> ou <code>1126263841</code>.
            Será normalizado para E.164 (<code>+551126263841</code>) automaticamente.
          </FormDescription>
          {(form.formState.errors.ddd || form.formState.errors.number) && (
            <p className="text-sm font-medium text-destructive" role="alert">
              Informe um número brasileiro válido (DDD + 8 ou 9 dígitos).
            </p>
          )}
        </FormItem>

        <FormField
          control={form.control}
          name="label"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Rótulo</FormLabel>
              <FormControl>
                <Input placeholder="Suporte, Vendas, Recepção…" {...field} />
              </FormControl>
              <FormDescription>Identificação interna do número (não vai para o cliente).</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          <p>
            <strong>Context Asterisk:</strong> derivado automaticamente do tenant da empresa selecionada
            (<code>from-{"{tenantSlug}"}</code>). Não requer configuração manual.
          </p>
        </div>

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button type="submit" disabled={submitMutation.isPending}>
            {submitMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            Cadastrar Número
          </Button>
        </div>
      </form>
    </Form>
  );
}