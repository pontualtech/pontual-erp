# Financeiro — Resolver de Conta Destino (fim do `account_id` null) — Plano

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) ou subagent-driven-development. Steps com checkbox `- [ ]`.

**Goal:** Toda AR marcada RECEBIDO passa a ter `account_id` (conta destino) preenchido automaticamente, eliminando os 93 ARs sem banco (R$75.270 = 40% da receita) e o gap de saldo bancário/conciliação.

**Architecture:** Um resolvedor central `resolveDestinationAccount(companyId, paymentMethod, source)` lê um mapa método→conta (settings `finance.account.*`, reusando `acquirer.rede.account_id` e `cnab.account_id`). Todos os fluxos de cobrança (entrega motorista, balcão/transition, portal split, perform-match) resolvem e passam o account_id ao criar/atualizar a AR. `payment_method` é normalizado pra um enum canônico. Backfill retroativo dos 93 ARs + Transactions de crédito faltantes, com pg_dump antes.

**Tech Stack:** Next 14 App Router, Prisma, Supabase self-hosted (PostgREST), TypeScript.

---

## Pré-requisito P0 — Mapa método→conta (decisão do Karlão, BLOQUEIA tudo)

Confirmar em qual conta cada método **liquida de verdade**:

| Método (canônico) | Conta destino | Setting |
|---|---|---|
| PIX | ? (ASSAS `53a061c4`?) | `finance.account.pix` |
| BOLETO | Inter `94938baa` (já = cnab) | `finance.account.boleto` |
| CREDIT_CARD (maquininha) | Itaú `0732aeac` (= acquirer.rede) | reusa `acquirer.rede.account_id` |
| DEBIT_CARD (maquininha) | Itaú `0732aeac` | reusa `acquirer.rede.account_id` |
| CASH | ? (não existe conta "Caixa" — criar?) | `finance.account.cash` |
| default/fallback | ? | `finance.account.default` |

⚠️ Sem isso, o resolver não tem pra onde mapear. Karlão preenche a coluna "Conta destino".

---

## Fase 1 — Restore point (antes de qualquer escrita)

- [ ] **Step 1.1:** pg_dump das tabelas financeiras (accounts_receivable, payments, transactions, accounts, settings) via pg na 37.27.42.114:5433 → arquivo datado em `C:\tmp\`. Tag git `pre-finance-account-resolver-2026-06-13`.

## Fase 2 — Resolver + normalização (lib pura, TDD)

**Files:**
- Create: `apps/web/src/lib/financeiro/account-resolver.ts`
- Test: script node standalone (checar se há jest/vitest primeiro; se não, script `.mjs`)

- [ ] **Step 2.1: Checar framework de teste** — `cat apps/web/package.json | grep -E "jest|vitest"`. Se ausente, usar script `.mjs` de asserts.
- [ ] **Step 2.2: Escrever teste falhando** pra `normalizePaymentMethod` e `resolveDestinationAccount` (mapeia método→account_id; null+warn se não mapeado).
- [ ] **Step 2.3: Implementar** `account-resolver.ts`:

```ts
// Mapa canônico de payment_method. Normaliza os rótulos divergentes do banco
// (CREDIT_CARD vs "Cartão Crédito", BOLETO vs "Boleto", etc.) pra um enum.
export type CanonicalMethod = 'PIX' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'BOLETO' | 'CASH' | 'OTHER'

export function normalizePaymentMethod(raw?: string | null): CanonicalMethod {
  const s = (raw || '').trim().toLowerCase()
  if (/pix/.test(s)) return 'PIX'
  if (/(debito|debit)/.test(s)) return 'DEBIT_CARD'
  if (/(credito|credit|cart[aã]o)/.test(s)) return 'CREDIT_CARD'
  if (/(boleto|cnab)/.test(s)) return 'BOLETO'
  if (/(dinheiro|cash|especie)/.test(s)) return 'CASH'
  return 'OTHER'
}

// Settings keys por método (P0). Reusa as 2 já existentes.
const SETTING_KEY: Record<CanonicalMethod, string> = {
  PIX: 'finance.account.pix',
  BOLETO: 'finance.account.boleto',
  CREDIT_CARD: 'acquirer.rede.account_id',
  DEBIT_CARD: 'acquirer.rede.account_id',
  CASH: 'finance.account.cash',
  OTHER: 'finance.account.default',
}

export async function resolveDestinationAccount(
  prisma: any, companyId: string, paymentMethod?: string | null,
): Promise<string | null> {
  const method = normalizePaymentMethod(paymentMethod)
  const key = SETTING_KEY[method]
  const s = await prisma.setting.findFirst({ where: { company_id: companyId, key }, select: { value: true } })
  if (s?.value) return s.value
  // fallback default
  const def = await prisma.setting.findFirst({ where: { company_id: companyId, key: 'finance.account.default' }, select: { value: true } })
  if (def?.value) return def.value
  console.warn(`[account-resolver] sem conta pra metodo=${method} company=${companyId} — AR ficara sem account_id`)
  return null
}
```

- [ ] **Step 2.4: Rodar teste → PASS.** **Step 2.5: Commit.**

## Fase 3 — Config (settings do mapa)

- [ ] **Step 3.1:** Inserir via PostgREST os settings `finance.account.{pix,boleto,cash,default}` com os valores do P0 (PT + IMP). `acquirer.rede.account_id` e `cnab.account_id` já existem.

## Fase 4 — Wire nos fluxos (cada um resolve+passa account_id)

- [ ] **Step 4.1:** `lib/financeiro/receivables.ts` — se `accountId` não veio nos args, resolver via `resolveDestinationAccount(prisma, companyId, paymentMethod)` antes do create. (Fallback central — pega todos os callers de uma vez.)
- [ ] **Step 4.2:** `lib/acquirer/perform-match.ts` — adicionar `account_id: acquirerAccountId` no `accountReceivable.create` (linha ~146-161).
- [ ] **Step 4.3:** `driver/stop/[id]/entrega`, `os/[id]/transition`, `portal/payments/split` — garantir que passam `paymentMethod` ao helper (pra o fallback resolver). Verificar cada um.
- [ ] **Step 4.4:** tsc limpo + `next build` local (1 build, anti-OOM).

## Fase 5 — Backfill (por último, validado, com restore point da Fase 1)

- [ ] **Step 5.1:** Script: pra cada um dos 93 ARs RECEBIDO com account_id null → resolver account_id pelo payment_method/descrição → PATCH account_id.
- [ ] **Step 5.2:** Pra ARs sem Transaction de crédito (ex: 60510/60515/60193, R$2.066,77) → criar Transaction CREDIT (líquido) na conta resolvida + ajustar saldo. Idempotente (bank_ref dedup).
- [ ] **Step 5.3:** Re-rodar a varredura: contagem de RECEBIDO com account_id null deve cair pra ~0. Verificar saldos.

## Fase 6 — Deploy + verificação

- [ ] **Step 6.1:** Merge → tag → push → deploy manual (1 build) → verificar uptime reset + saúde.
- [ ] **Step 6.2:** Confirmar no UI que a AR OS-60760 não mostra mais "Nenhum banco vinculado".

---

## Self-review
- Cobertura: P0 (mapa) → resolver → config → wire (4 fluxos) → backfill (account_id + Transactions) → deploy. ✅
- Sem placeholder no resolver (código real). Backfill detalhado.
- Dependência crítica: **P0 (mapa método→conta) precisa do Karlão antes de tudo.**
