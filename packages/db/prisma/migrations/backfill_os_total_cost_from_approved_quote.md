# Backfill 2026-04-29: OSes com Quote APROVADO mas total_cost=0

## Origem do bug

`/api/quotes/approve/[token]/route.ts` atualizava o Quote pra APPROVED mas
nao copiava `total_amount` pra `service_order.total_cost`. Match-engine
de maquininha compara por `service_order.total_cost`, entao essas OSes
nunca casavam com transacoes Rede.

Fix de codigo: `apps/web/src/lib/quote-os-sync.ts` + chamada no approve.

## Como rodar (one-shot)

Conectar no Postgres do Supabase self-hosted (porta 5433) e executar
as 3 queries abaixo em ordem.

**IDEMPOTENTE:** rodar mais de uma vez nao causa efeito colateral
(filtra so `total_cost = 0` ou NULL).

### Passo 1: Preview — quantas OSes serao corrigidas

```sql
SELECT
  COUNT(*) AS total_osys_a_corrigir,
  SUM(q.total_amount) AS total_centavos_a_propagar
FROM service_orders so
JOIN quotes q ON q.service_order_id = so.id
WHERE so.deleted_at IS NULL
  AND q.status = 'APPROVED'
  AND q.total_amount > 0
  AND COALESCE(so.total_cost, 0) = 0;
```

### Passo 2: Backfill (UPDATE)

```sql
WITH latest_approved AS (
  SELECT DISTINCT ON (q.service_order_id)
    q.service_order_id,
    q.total_amount,
    q.approved_at
  FROM quotes q
  WHERE q.status = 'APPROVED'
    AND q.total_amount > 0
  ORDER BY q.service_order_id, q.approved_at DESC NULLS LAST
)
UPDATE service_orders so
SET
  total_cost    = la.total_amount,
  approved_cost = la.total_amount,
  updated_at    = NOW()
FROM latest_approved la
WHERE so.id = la.service_order_id
  AND so.deleted_at IS NULL
  AND COALESCE(so.total_cost, 0) = 0;
```

### Passo 3: Verificacao pos-backfill

```sql
SELECT
  COUNT(*) AS osys_ainda_zeradas_com_quote_aprovado
FROM service_orders so
JOIN quotes q ON q.service_order_id = so.id
WHERE so.deleted_at IS NULL
  AND q.status = 'APPROVED'
  AND q.total_amount > 0
  AND COALESCE(so.total_cost, 0) = 0;
```

Esperado: 0 linhas.

## Rollback

Se for necessario reverter, restaurar `service_orders` do `pg_dump` feito
antes do backfill. Tabelas afetadas: apenas `service_orders` (campos
`total_cost`, `approved_cost`, `updated_at`).
