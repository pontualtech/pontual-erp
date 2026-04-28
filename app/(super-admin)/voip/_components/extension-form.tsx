"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { createExtensionSchema, updateExtensionSchema } from "@/lib/voip/zod-schemas";

// Reuse Bernardo's schema and add a Phase-1-only refinement: range 100-109
const f1CreateExtensionSchema = createExtensionSchema.refine(
  (data) => {
    const n = Number(data.number);
    return Number.isInteger(n) && n >= 100 && n <= 109;
  },
  {
    message: "Na Fase 1, apenas ramais de 100 a 109 são permitidos.",
    path: ["number"],
  }
);

type CreateValues = z.infer<typeof f1CreateExtensionSchema>;
type UpdateValues = z.infer<typeof updateExtensionSchema>;

type Company = { id: string; name: string };
type User = { id: string; name: string; email: string };

type Extension = {
  id: string;
  companyId: string;
  number: string;
  displayName: string;
  userId: string | null;
  context: string;
  tenantTag: string;
  status: "ACTIVE" | "DISABLED" | "PROVISIONING";
  maxContacts: number;
  callLimit: number | null;
  codecs: string[];
  dtmfMode: string;
};

const ALL_CODECS = ["ulaw", "alaw", "g729", "opus"] as const;

interface ExtensionFormProps {
  initial?: Extension | null;
  onSuccess: (oneTimeSecret?: string) => void;
}

export function ExtensionForm({ initial, onSuccess }: ExtensionFormProps) {
  const isEdit = !!initial;
  const schema = isEdit ? updateExtensionSchema : f1CreateExtensionSchema;

  // We use one form type (CreateValues) and just hide some fields in edit mode
  const form = useForm<CreateValues>({
    resolver: zodResolver(schema as unknown as typeof f1CreateExtensionSchema),
    defaultValues: initial
      ? {
          companyId: initial.companyId,
          number: initial.number,
          displayName: initial.displayName,
          userId: initial.userId ?? undefined,
          context: initial.context,
          tenantTag: initial.tenantTag,
          codecs: initial.codecs as CreateValues["codecs"],
          dtmfMode: initial.dtmfMode as CreateValues["dtmfMode"],
          maxContacts: initial.maxContacts,
          callLimit: initial.callLimit ?? undefined,
        }
      : {
          companyId: "",
          number: "",
          displayName: "",
          context: "from-pontualtech",
          tenantTag: "pontualtech",
          codecs: ["ulaw", "alaw"],
          dtmfMode: "rfc4733",
          maxContacts: 2,
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

  const usersQuery = useQuery<{ data: User[] }>({
    queryKey: ["super-admin", "users", selectedCompanyId],
    queryFn: async () => {
      const res = await fetch(`/api/super-admin/users?companyId=${selectedCompanyId}&limit=200`);
      if (!res.ok) throw new Error("Falha ao carregar usuários");
      return res.json();
    },
    enabled: !!selectedCompanyId,
    staleTime: 60_000,
  });

  const submitMutation = useMutation({
    mutationFn: async (values: CreateValues): Promise<{ secret?: string }> => {
      const url = initial ? `/api/voip/extensions/${initial.id}` : "/api/voip/extensions";
      const method = initial ? "PUT" : "POST";

      // In edit mode, omit immutable fields
      let payload: CreateValues | UpdateValues = values;
      if (initial) {
        const { companyId: _c, number: _n, ...rest } = values;
        payload = rest as UpdateValues;
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw { httpError: true, body: err };
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast.success(initial ? "Ramal atualizado" : "Ramal criado — guarde a senha exibida");
      onSuccess(data?.secret);
    },
    onError: (err: { httpError?: boolean; body?: { error?: string; details?: Record<string, string[]> } }) => {
      if (err?.body?.details) {
        for (const [field, messages] of Object.entries(err.body.details)) {
          form.setError(field as keyof CreateValues, {
            type: "server",
            message: Array.isArray(messages) ? messages[0] : String(messages),
          });
        }
      }
      toast.error(err?.body?.error ?? "Falha ao salvar ramal");
    },
  });

  const onSubmit = (values: CreateValues) => submitMutation.mutate(values);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="companyId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Empresa</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={field.value}
                  disabled={isEdit /* imutável */}
                >
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
            name="number"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Número do Ramal</FormLabel>
                <FormControl>
                  <Input
                    inputMode="numeric"
                    placeholder="100"
                    maxLength={4}
                    disabled={isEdit /* imutável */}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  Faixa permitida na Fase 1: <strong>100 a 109</strong>.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="displayName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nome de Exibição</FormLabel>
              <FormControl>
                <Input placeholder="João — Atendimento" {...field} />
              </FormControl>
              <FormDescription>Apelido exibido em chamadas internas (Caller-ID interno).</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="userId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Usuário Vinculado (opcional)</FormLabel>
              <Select
                onValueChange={field.onChange}
                value={field.value ?? ""}
                disabled={!selectedCompanyId}
              >
                <FormControl>
                  <SelectTrigger aria-label="Usuário vinculado">
                    <SelectValue placeholder={selectedCompanyId ? "Selecione um usuário" : "Selecione a empresa primeiro"} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {usersQuery.data?.data.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name} ({u.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>
                Vincular o ramal a um usuário do ERP (preparação para SSO/login mobile na Fase 5).
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="context"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Context (Asterisk)</FormLabel>
                <FormControl>
                  <Input placeholder="from-pontualtech" {...field} />
                </FormControl>
                <FormDescription>Dialplan context onde o ramal opera.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="tenantTag"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tenant Tag</FormLabel>
                <FormControl>
                  <Input placeholder="pontualtech" {...field} />
                </FormControl>
                <FormDescription>Slug ASCII (a-z, 0-9, hífen). Vai para <code>tenantid=</code> no pjsip.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="codecs"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Codecs</FormLabel>
              <div className="grid grid-cols-2 gap-2 rounded border p-3 sm:grid-cols-4">
                {ALL_CODECS.map((codec) => {
                  const checked = field.value?.includes(codec) ?? false;
                  return (
                    <Label key={codec} className="flex cursor-pointer items-center gap-2">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(c) => {
                          const set = new Set(field.value ?? []);
                          if (c) set.add(codec); else set.delete(codec);
                          field.onChange(Array.from(set));
                        }}
                        aria-label={codec}
                      />
                      <span className="font-mono text-sm">{codec}</span>
                    </Label>
                  );
                })}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <FormField
            control={form.control}
            name="dtmfMode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Modo DTMF</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger aria-label="Modo DTMF">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="rfc4733">RFC 4733</SelectItem>
                    <SelectItem value="inband">In-band</SelectItem>
                    <SelectItem value="info">SIP INFO</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="maxContacts"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Máx. Contatos</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={1}
                    max={5}
                    {...field}
                    onChange={(e) => field.onChange(Number(e.target.value))}
                  />
                </FormControl>
                <FormDescription>Quantos dispositivos simultâneos (softphone + mobile).</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="callLimit"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Limite de Chamadas (opcional)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    placeholder="Sem limite"
                    {...field}
                    value={field.value ?? ""}
                    onChange={(e) =>
                      field.onChange(e.target.value === "" ? undefined : Number(e.target.value))
                    }
                  />
                </FormControl>
                <FormDescription>Máximo de chamadas simultâneas neste ramal.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button type="submit" disabled={submitMutation.isPending}>
            {submitMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {initial ? "Salvar Alterações" : "Criar Ramal"}
          </Button>
        </div>
      </form>
    </Form>
  );
}