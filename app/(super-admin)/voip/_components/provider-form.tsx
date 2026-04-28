"use client";

import { useEffect, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { createProviderSchema } from "@/lib/voip/zod-schemas";

type FormValues = z.infer<typeof createProviderSchema>;

type Company = { id: string; name: string };

type Provider = {
  id: string;
  companyId: string;
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
  qualifyFrequency: number;
  contextInbound: string;
  isActive: boolean;
};

const ALL_CODECS = ["ulaw", "alaw", "g729", "opus"] as const;

interface ProviderFormProps {
  initial?: Provider | null;
  onSuccess: () => void;
}

export function ProviderForm({ initial, onSuccess }: ProviderFormProps) {
  const [showSecret, setShowSecret] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(createProviderSchema),
    defaultValues: initial
      ? {
          companyId: initial.companyId,
          name: initial.name,
          hostOutbound: initial.hostOutbound,
          hostInbound: initial.hostInbound ?? undefined,
          port: initial.port,
          transport: initial.transport,
          authMethod: initial.authMethod,
          username: initial.username ?? undefined,
          secret: undefined,
          matchIp: initial.matchIp ?? undefined,
          codecs: initial.codecs as FormValues["codecs"],
          dtmfMode: initial.dtmfMode as FormValues["dtmfMode"],
          qualifyFrequency: initial.qualifyFrequency,
          contextInbound: initial.contextInbound,
        }
      : {
          companyId: "",
          name: "",
          hostOutbound: "",
          port: 5060,
          transport: "udp",
          authMethod: "IP_BASED",
          codecs: ["ulaw", "alaw"],
          dtmfMode: "rfc4733",
          qualifyFrequency: 60,
          contextInbound: "",
        },
  });

  const authMethod = form.watch("authMethod");

  const companiesQuery = useQuery<{ data: Company[] }>({
    queryKey: ["super-admin", "companies"],
    queryFn: async () => {
      const res = await fetch("/api/super-admin/companies?limit=200");
      if (!res.ok) throw new Error("Falha ao carregar empresas");
      return res.json();
    },
    staleTime: 60_000,
  });

  const submitMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const url = initial ? `/api/voip/providers/${initial.id}` : "/api/voip/providers";
      const method = initial ? "PUT" : "POST";
      // No edit, only send `secret` if user typed a new one
      const payload: Partial<FormValues> = { ...values };
      if (initial && !values.secret) {
        delete payload.secret;
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
    onSuccess: () => {
      toast.success(initial ? "Provedor atualizado" : "Provedor criado");
      onSuccess();
    },
    onError: (err: { httpError?: boolean; body?: { error?: string; details?: Record<string, string[]> } }) => {
      // Map server-side validation errors to fields
      if (err?.body?.details) {
        for (const [field, messages] of Object.entries(err.body.details)) {
          form.setError(field as keyof FormValues, {
            type: "server",
            message: Array.isArray(messages) ? messages[0] : String(messages),
          });
        }
      }
      toast.error(err?.body?.error ?? "Falha ao salvar provedor");
    },
  });

  const onSubmit = (values: FormValues) => {
    submitMutation.mutate(values);
  };

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
                  disabled={!!initial /* imutável em edição */}
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
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nome do Provedor</FormLabel>
                <FormControl>
                  <Input placeholder="Sonax PontualTech" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <FormField
            control={form.control}
            name="hostOutbound"
            render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel>Host de Saída</FormLabel>
                <FormControl>
                  <Input placeholder="proxy.sonavoip.com.br" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="port"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Porta</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={1}
                    max={65535}
                    {...field}
                    onChange={(e) => field.onChange(Number(e.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="hostInbound"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Host de Entrada (opcional)</FormLabel>
              <FormControl>
                <Input
                  placeholder="did.sonavoip.com.br"
                  {...field}
                  value={field.value ?? ""}
                />
              </FormControl>
              <FormDescription>
                Apenas se o provedor usar host distinto para chamadas recebidas.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="transport"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Transporte</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger aria-label="Transporte">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="udp">UDP</SelectItem>
                    <SelectItem value="tcp">TCP</SelectItem>
                    <SelectItem value="tls">TLS</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="authMethod"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Método de Autenticação</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger aria-label="Método de autenticação">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="IP_BASED">IP autorizado (recomendado Sonax)</SelectItem>
                    <SelectItem value="USER_SECRET">Usuário e senha</SelectItem>
                  </SelectContent>
                </Select>
                <FormDescription>
                  IP autorizado: o provedor confia no IP da VPS. Usuário/senha: registration outbound.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {authMethod === "IP_BASED" && (
          <FormField
            control={form.control}
            name="matchIp"
            render={({ field }) => (
              <FormItem>
                <FormLabel>IP / CIDR Autorizado</FormLabel>
                <FormControl>
                  <Input
                    placeholder="200.123.45.67 ou 200.123.45.0/24"
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormDescription>
                  IP público da VPS Hetzner que está autorizado no provedor.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {authMethod === "USER_SECRET" && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Usuário</FormLabel>
                  <FormControl>
                    <Input
                      autoComplete="off"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="secret"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Senha</FormLabel>
                  <div className="relative">
                    <FormControl>
                      <Input
                        type={showSecret ? "text" : "password"}
                        autoComplete="new-password"
                        placeholder={initial?.hasSecret ? "••••••••  (deixe em branco para manter)" : ""}
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="absolute right-1 top-1/2 -translate-y-1/2"
                      onClick={() => setShowSecret((v) => !v)}
                      aria-label={showSecret ? "Ocultar senha" : "Mostrar senha"}
                      aria-pressed={showSecret}
                    >
                      {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  <FormDescription>
                    {initial?.hasSecret
                      ? "Em edição, a senha é re-criptografada apenas se preenchida."
                      : "A senha é criptografada (AES-256-GCM) antes de ser armazenada."}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}

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
                    <Label
                      key={codec}
                      className="flex cursor-pointer items-center gap-2"
                    >
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
              <FormDescription>
                Mínimo: <code>ulaw</code> e <code>alaw</code>. Outros codecs podem requerer licença Asterisk.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
                    <SelectItem value="rfc4733">RFC 4733 (recomendado)</SelectItem>
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
            name="qualifyFrequency"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Qualify Frequency (segundos)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    max={3600}
                    {...field}
                    onChange={(e) => field.onChange(Number(e.target.value))}
                  />
                </FormControl>
                <FormDescription>0 desativa qualify. Padrão: 60.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="contextInbound"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Context Inbound (Asterisk)</FormLabel>
              <FormControl>
                <Input placeholder="from-sonax-pontualtech" {...field} />
              </FormControl>
              <FormDescription>
                Nome do dialplan context para chamadas recebidas deste provedor. Não usar caracteres especiais.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button
            type="submit"
            disabled={submitMutation.isPending}
          >
            {submitMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {initial ? "Salvar Alterações" : "Criar Provedor"}
          </Button>
        </div>
      </form>
    </Form>
  );
}