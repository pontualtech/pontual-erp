#!/bin/sh
# ensure-financeiro-extras.sh
# Garante extras do refactor financeiro v2 que Prisma db push NÃO suporta:
#   - RLS policies (multi-tenant + service_role bypass)
#   - Triggers (audit log automático em payments + updated_at)
#   - Materialized View (DRE mensal)
#   - Generated columns (fiscal_period em fiscal_entries)
#   - CHECK constraints adicionais
#   - Seed plano de contas PontualTech
#
# Roda DEPOIS de prisma db push no start.sh.
# Idempotente: IF NOT EXISTS / DO blocks / ON CONFLICT DO NOTHING.
# Falha não-fatal: log + continua boot do Next.js (financeiro core funciona sem).
#
# Padrão herdado de ensure-voip-extensions.sh (incidente 2026-05-01).
# Spec: squads/financeiro-restructure-spec/output/architecture-spec.md

set -u

DB_URL="${DATABASE_URL:-}"
if [ -z "$DB_URL" ]; then
  echo "[ensure-financeiro] WARN: DATABASE_URL not set, skipping" >&2
  exit 0
fi

node <<'JS'
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  // Cria tabela de diagnóstico ANTES de qualquer outra coisa pra
  // sempre conseguir registrar o estado mesmo em falha precoce.
  try {
    await p.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS _ensure_financeiro_log (
        id serial primary key,
        ran_at timestamptz default now(),
        chart_count int default 0,
        seeded int default 0,
        fiscal_pipeline_ok boolean default false,
        backfill_count int default 0,
        m012_enabled boolean default false,
        m012_ar int default 0,
        m012_ap int default 0,
        rls_strict boolean default false,
        notes text,
        last_error text
      );
    `);
  } catch (e) {
    console.error('[ensure-financeiro] FATAL: diag table creation:', e.message);
  }

  let diagState = {
    chartCount: 0, seeded: 0, fiscalPipelineOk: false,
    backfillCount: 0, m012Ar: 0, m012Ap: 0,
    rlsStrict: process.env.PONTUAL_RLS_STRICT === '1',
    m012Enabled: process.env.PONTUAL_BACKFILL_M012 === '1',
    notes: '', lastError: null,
  };

  async function writeDiag() {
    try {
      await p.$executeRawUnsafe(`
        INSERT INTO _ensure_financeiro_log (
          chart_count, seeded, fiscal_pipeline_ok, backfill_count,
          m012_enabled, m012_ar, m012_ap, rls_strict, notes, last_error
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, diagState.chartCount, diagState.seeded, diagState.fiscalPipelineOk,
        diagState.backfillCount, diagState.m012Enabled, diagState.m012Ar,
        diagState.m012Ap, diagState.rlsStrict, diagState.notes, diagState.lastError);
    } catch (e) {
      console.warn('[ensure-financeiro] diag insert: ' + e.message);
    }
  }

  try {
    // 1. Função genérica trg_set_updated_at
    await p.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION trg_set_updated_at() RETURNS trigger AS $func$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $func$ LANGUAGE plpgsql;
    `);

    // A6 fix (audit): tabela _trigger_failures registra falhas dos triggers
    // EXCEPTION-safe (audit, dual-write AR/AP, fiscal_entries pipeline).
    // Antes: RAISE WARNING vai pra log PostgreSQL mas não é visível na app
    // (depende de client_min_messages) — falhas silenciadas mascarvam dual-
    // write quebrado, audit log incompleto, etc.
    // Agora: cada EXCEPTION grava em _trigger_failures + ainda RAISE WARNING
    // pra compat. Cron pode consultar a tabela diariamente e alertar.
    await p.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS _trigger_failures (
        id serial primary key,
        trigger_name text NOT NULL,
        payload jsonb,
        error_msg text,
        error_state text,
        created_at timestamptz DEFAULT NOW()
      );
    `);
    await p.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_trigger_failures_recent
        ON _trigger_failures (created_at DESC);
    `);
    await p.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION fn_record_trigger_failure(
        p_trigger text, p_payload jsonb, p_msg text, p_state text
      ) RETURNS void AS $rec$
      BEGIN
        INSERT INTO _trigger_failures (trigger_name, payload, error_msg, error_state)
        VALUES (p_trigger, p_payload, p_msg, p_state);
      EXCEPTION WHEN OTHERS THEN
        -- Ultimate fallback: se até o registro de falha falhar, só loga
        RAISE WARNING 'fn_record_trigger_failure ITSELF failed for %: % (%)', p_trigger, SQLERRM, SQLSTATE;
      END;
      $rec$ LANGUAGE plpgsql SECURITY DEFINER;
    `);

    // 2. RLS em tabelas tenant-scoped (lazy mode: NULL setting bypass)
    // feature_flags NÃO entra aqui — é global (sem company_id).
    const rlsTables = [
      'payments',
      'payment_history',
      'webhook_events_log',
      'accounts_chart',
      'fiscal_entries',
      // M-008: régua de cobrança
      'cobranca_rules',
      'cobranca_rule_steps',
      'payment_reminders',
      // M-010: feature flags (apenas tenant override tem company_id)
      'tenant_feature_flags',
      // M-009: configurações per-tenant
      'payment_method_configs',
      'payment_terms',
      // M-011: conciliação
      'reconciliation_batches',
      'reconciliation_entries',
    ];

    // M-007 mode flag: PONTUAL_RLS_STRICT=1 ativa RLS strict (sem bypass).
    // Default lazy: bypass quando app.company_id não está setado (pra
    // compatibilidade com routes que ainda não migraram pra withTenantTx).
    const rlsStrict = process.env.PONTUAL_RLS_STRICT === '1';
    console.log(`[ensure-financeiro] RLS mode: ${rlsStrict ? 'STRICT (M-007)' : 'lazy (default)'}`);

    for (const t of rlsTables) {
      // Pula tabela inexistente — Prisma db push pode ter falhado em criar.
      const exists = await p.$queryRawUnsafe(
        `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
        t
      );
      if (!exists || exists.length === 0) {
        console.warn(`[ensure-financeiro] table ${t} not found, skipping RLS`);
        continue;
      }
      await p.$executeRawUnsafe(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`);
      await p.$executeRawUnsafe(`DROP POLICY IF EXISTS ${t}_tenant_isolation ON ${t};`);
      await p.$executeRawUnsafe(`DROP POLICY IF EXISTS ${t}_service_role ON ${t};`);

      if (rlsStrict) {
        // STRICT: bloqueia tudo se app.company_id não setado. Routes DEVEM
        // usar withTenantTx() do @pontual/db pra setar antes de qualquer query.
        await p.$executeRawUnsafe(`
          CREATE POLICY ${t}_tenant_isolation ON ${t}
            USING (company_id = current_setting('app.company_id', true));
        `);
      } else {
        // LAZY (default): bypass quando app.company_id não setado.
        await p.$executeRawUnsafe(`
          CREATE POLICY ${t}_tenant_isolation ON ${t}
            USING (
              company_id = current_setting('app.company_id', true)
              OR current_setting('app.company_id', true) IS NULL
              OR current_setting('app.company_id', true) = ''
            );
        `);
      }
      await p.$executeRawUnsafe(`
        CREATE POLICY ${t}_service_role ON ${t}
          TO service_role
          USING (true) WITH CHECK (true);
      `);
    }

    // 3. Triggers updated_at em payments, accounts_chart, cobranca_rules,
    //    payment_method_configs, payment_terms (M-009)
    for (const t of ['payments', 'accounts_chart', 'cobranca_rules',
                      'payment_method_configs', 'payment_terms']) {
      const exists = await p.$queryRawUnsafe(
        `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
        t
      );
      if (!exists || exists.length === 0) continue;
      await p.$executeRawUnsafe(`DROP TRIGGER IF EXISTS trg_${t}_updated_at ON ${t};`);
      await p.$executeRawUnsafe(`
        CREATE TRIGGER trg_${t}_updated_at
          BEFORE UPDATE ON ${t}
          FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
      `);
    }

    // 4. Trigger payment_history_trigger (audit log) — EXCEPTION-safe
    const paymentsExists = await p.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='payments'`
    );
    const phExists = await p.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='payment_history'`
    );

    if (paymentsExists.length > 0 && phExists.length > 0) {
      await p.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION payment_history_trigger() RETURNS trigger AS $fn$
        DECLARE
          v_event       text;
          v_old_status  text;
          v_new_status  text;
          v_amount_delta bigint;
        BEGIN
          IF TG_OP = 'INSERT' THEN
            v_event := 'CREATED';
            v_new_status := NEW.status;
          ELSIF TG_OP = 'UPDATE' THEN
            IF OLD.status IS DISTINCT FROM NEW.status THEN
              v_event := 'STATUS_CHANGED';
            ELSE
              v_event := 'UPDATED';
            END IF;
            v_old_status := OLD.status;
            v_new_status := NEW.status;
            IF OLD.paid_amount IS DISTINCT FROM NEW.paid_amount THEN
              v_amount_delta := COALESCE(NEW.paid_amount, 0) - COALESCE(OLD.paid_amount, 0);
            END IF;
          ELSIF TG_OP = 'DELETE' THEN
            v_event := 'DELETED';
            v_old_status := OLD.status;
          END IF;

          BEGIN
            INSERT INTO payment_history(
              company_id, payment_id, event_type,
              old_status, new_status, old_value, new_value, amount_delta,
              source, user_id
            ) VALUES (
              COALESCE(NEW.company_id, OLD.company_id),
              COALESCE(NEW.id, OLD.id),
              v_event,
              v_old_status, v_new_status,
              CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE NULL END,
              CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE NULL END,
              v_amount_delta,
              COALESCE(NULLIF(current_setting('app.audit_source', true), ''), 'TRIGGER'),
              NULLIF(current_setting('app.user_id', true), '')
            );
          EXCEPTION
            WHEN OTHERS THEN
              PERFORM fn_record_trigger_failure('payment_history_trigger', to_jsonb(NEW), SQLERRM, SQLSTATE);
              RAISE WARNING 'payment_history_trigger failed: % (%)', SQLERRM, SQLSTATE;
          END;

          RETURN COALESCE(NEW, OLD);
        END $fn$ LANGUAGE plpgsql SECURITY DEFINER;
      `);

      await p.$executeRawUnsafe(`DROP TRIGGER IF EXISTS trg_payments_audit ON payments;`);
      await p.$executeRawUnsafe(`
        CREATE TRIGGER trg_payments_audit
          AFTER INSERT OR UPDATE OR DELETE ON payments
          FOR EACH ROW EXECUTE FUNCTION payment_history_trigger();
      `);
    }

    // 5. CHECK constraints adicionais (idempotente via DO blocks)
    const checkConstraints = [
      { table: 'payment_history', name: 'chk_payment_history_event_type',
        check: `event_type IN ('CREATED','UPDATED','STATUS_CHANGED','PAYMENT_RECEIVED','PAYMENT_REFUNDED','RECONCILED','CANCELLED','DELETED')` },
      { table: 'payment_history', name: 'chk_payment_history_source',
        check: `source IN ('USER','WEBHOOK','CRON','RECONCILIATION','API','TRIGGER')` },
      { table: 'fiscal_entries',  name: 'chk_fiscal_source',
        check: `source IN ('PAYMENT','MANUAL_ADJUSTMENT','TAX_CALC','PROVISIONING')` },
      { table: 'fiscal_entries',  name: 'chk_fiscal_amount_nonzero', check: `amount <> 0` },
      { table: 'accounts_chart',  name: 'chk_chart_no_self_parent',
        check: `parent_id IS NULL OR parent_id <> id` },
      // M-008: régua de cobrança constraints
      { table: 'cobranca_rule_steps', name: 'chk_step_order_positive',
        check: `step_order > 0` },
      // A1 fix (audit): trocado de `< 5` pra `<= 5`. Dispatcher precisa
      // gravar attempts=5 quando reminder atinge max retries (status=FAILED).
      // Constraint anterior bloqueava isso → exception silenciosa, reminder
      // ficava preso em PENDING infinitamente. Nome mudou pra refletir nova
      // semântica; old constraint dropada junto.
      { table: 'payment_reminders',   name: 'chk_attempts_le_5',
        check: `attempts BETWEEN 0 AND 5`,
        dropOld: 'chk_attempts_lt_5' },
      // M-010: feature_flags rollout_pct entre 0-100
      { table: 'feature_flags', name: 'chk_rollout_pct_range',
        check: `rollout_pct >= 0 AND rollout_pct <= 100` },
      // M-009: payment_method_configs.is_default_in valid values
      { table: 'payment_method_configs', name: 'chk_default_in_valid',
        check: `is_default_in IN ('RECEIVABLE','PAYABLE','BOTH','NONE')` },
      // M-009: payment_terms.installments 1-36
      { table: 'payment_terms', name: 'chk_installments_range',
        check: `installments BETWEEN 1 AND 36` },
      { table: 'payment_terms', name: 'chk_interval_days_nonneg',
        check: `interval_days >= 0` },
      // M-011: reconciliation_batches.source valid values
      { table: 'reconciliation_batches', name: 'chk_recon_source',
        check: `source IN ('OFX','CSV','CNAB_RETURN','ASAAS_API','REDE_API','MANUAL')` },
      // M-011: reconciliation_entries.match_score 0-100 (nullable)
      { table: 'reconciliation_entries', name: 'chk_match_score_range',
        check: `match_score IS NULL OR (match_score BETWEEN 0 AND 100)` },
    ];

    for (const c of checkConstraints) {
      const tblExists = await p.$queryRawUnsafe(
        `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
        c.table
      );
      if (!tblExists || tblExists.length === 0) continue;
      // A1: drop old constraint name se renomeada (graceful migration)
      if ((c as any).dropOld) {
        try {
          await p.$executeRawUnsafe(
            `ALTER TABLE ${c.table} DROP CONSTRAINT IF EXISTS ${(c as any).dropOld};`
          );
        } catch (e: any) {
          console.warn(`[ensure-financeiro] dropOld ${(c as any).dropOld}: ${e.message}`);
        }
      }
      await p.$executeRawUnsafe(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
             WHERE conname = '${c.name}' AND conrelid = '${c.table}'::regclass
          ) THEN
            ALTER TABLE ${c.table} ADD CONSTRAINT ${c.name} CHECK (${c.check});
          END IF;
        END $$;
      `);
    }

    // 6. Coluna fiscal_period em fiscal_entries — populada via trigger.
    //    Antes era GENERATED ALWAYS, mas Prisma 5.x não tem syntax declarativa
    //    e db push entrava em conflito com MV. Solução: coluna text + trigger
    //    BEFORE INSERT/UPDATE que computa o valor (semântica equivalente).
    //
    //    Idempotência:
    //    - Se coluna não existe (Prisma db push criou String?): cria trigger.
    //    - Se coluna era GENERATED de versão anterior: drop expression + trigger.
    //    - Se coluna existe + trigger existe: no-op.
    const feExists = await p.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='fiscal_entries'`
    );
    if (feExists.length > 0) {
      // Detecta se fiscal_period é GENERATED legacy
      // (no heredoc é JS plain — sem generics TS)
      const isGenerated = await p.$queryRawUnsafe(`
        SELECT is_generated FROM information_schema.columns
         WHERE table_name='fiscal_entries' AND column_name='fiscal_period'
      `);

      if (isGenerated.length > 0 && isGenerated[0].is_generated === 'ALWAYS') {
        // Legacy GENERATED column — drop expression pra virar coluna normal.
        // Postgres permite ALTER ... DROP EXPRESSION (mantém valores existentes).
        await p.$executeRawUnsafe(`ALTER TABLE fiscal_entries ALTER COLUMN fiscal_period DROP EXPRESSION;`);
      }

      // Função trigger que computa fiscal_period a partir de entry_date.
      // IMMUTABLE-safe: concatenação de EXTRACT (sem to_char STABLE).
      await p.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION trg_set_fiscal_period() RETURNS trigger AS $fn$
        BEGIN
          NEW.fiscal_period := EXTRACT(YEAR FROM NEW.entry_date)::text
            || '-' ||
            LPAD(EXTRACT(MONTH FROM NEW.entry_date)::text, 2, '0');
          RETURN NEW;
        END;
        $fn$ LANGUAGE plpgsql;
      `);

      await p.$executeRawUnsafe(`DROP TRIGGER IF EXISTS trg_fiscal_entries_period ON fiscal_entries;`);
      await p.$executeRawUnsafe(`
        CREATE TRIGGER trg_fiscal_entries_period
          BEFORE INSERT OR UPDATE OF entry_date ON fiscal_entries
          FOR EACH ROW EXECUTE FUNCTION trg_set_fiscal_period();
      `);

      // Backfill rows existentes que tenham fiscal_period NULL (raras pré-trigger)
      await p.$executeRawUnsafe(`
        UPDATE fiscal_entries
           SET fiscal_period = EXTRACT(YEAR FROM entry_date)::text || '-' ||
                               LPAD(EXTRACT(MONTH FROM entry_date)::text, 2, '0')
         WHERE fiscal_period IS NULL
      `);

      // Índice composto pra queries de DRE
      await p.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS idx_fiscal_company_period_account
          ON fiscal_entries (company_id, fiscal_period, chart_account_id);
      `);
    }

    // 7. Materialized View dre_monthly
    // A2 fix (audit): non-destructive boot. Antes DROP MV em todo boot
    // dropava todos os dados — se §11 falhasse depois, MV ficava vazia e
    // /api/financeiro/v2/dre retornava array vazio sem erro. Agora só
    // recria se MV NÃO existe; mudanças de definição requerem DROP manual.
    const acExists = await p.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='accounts_chart'`
    );
    if (feExists.length > 0 && acExists.length > 0) {
      const mvExists = await p.$queryRawUnsafe(
        `SELECT 1 FROM pg_matviews WHERE schemaname='public' AND matviewname='dre_monthly'`
      ) as any[];
      if (!mvExists || mvExists.length === 0) {
        // MV não existe — cria
        await p.$executeRawUnsafe(`
          CREATE MATERIALIZED VIEW dre_monthly AS
          SELECT
            fe.company_id,
            fe.fiscal_period,
            ac.account_type,
            ac.code,
            ac.name,
            SUM(fe.amount)::bigint AS total_cents
          FROM fiscal_entries fe
          JOIN accounts_chart ac ON ac.id = fe.chart_account_id
          WHERE fe.is_provisional = false
          GROUP BY fe.company_id, fe.fiscal_period, ac.account_type, ac.code, ac.name;
        `);
        console.log('[ensure-financeiro] dre_monthly MV criada (não existia)');
      }
      // Index é idempotente
      await p.$executeRawUnsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_dre_monthly_pk
          ON dre_monthly (company_id, fiscal_period, code);
      `);
      // Pra forçar recriação após mudança de definição: DROP manual via psql
      // ou setar PONTUAL_DRE_MV_FORCE_RECREATE=1 (drop ANTES desse bloco)
      if (process.env.PONTUAL_DRE_MV_FORCE_RECREATE === '1') {
        console.warn('[ensure-financeiro] PONTUAL_DRE_MV_FORCE_RECREATE=1 — recriando MV');
        await p.$executeRawUnsafe(`DROP MATERIALIZED VIEW IF EXISTS dre_monthly;`);
        await p.$executeRawUnsafe(`
          CREATE MATERIALIZED VIEW dre_monthly AS
          SELECT fe.company_id, fe.fiscal_period, ac.account_type, ac.code, ac.name,
                 SUM(fe.amount)::bigint AS total_cents
          FROM fiscal_entries fe
          JOIN accounts_chart ac ON ac.id = fe.chart_account_id
          WHERE fe.is_provisional = false
          GROUP BY fe.company_id, fe.fiscal_period, ac.account_type, ac.code, ac.name;
        `);
        await p.$executeRawUnsafe(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_dre_monthly_pk
            ON dre_monthly (company_id, fiscal_period, code);
        `);
      }
    }

    // 8. Seed PontualTech (plano de contas) — idempotente via ON CONFLICT
    let seeded = 0;
    let chartCount = 0;
    if (acExists.length > 0) {
      const chartSeed = [
        ['1',     'Receitas',                       'REVENUE',           true,  10],
        ['1.1',   'Receita de Servicos',            'REVENUE',           true,  11],
        ['1.1.01','Reparo de Impressoras',          'REVENUE',           false, 12],
        ['1.1.02','Manutencao Preventiva',          'REVENUE',           false, 13],
        ['1.1.03','Coleta e Entrega',               'REVENUE',           false, 14],
        ['1.2',   'Receita de Vendas',              'REVENUE',           true,  15],
        ['1.2.01','Venda de Pecas',                 'REVENUE',           false, 16],
        ['1.2.02','Venda de Insumos',               'REVENUE',           false, 17],
        ['2',     'Deducoes da Receita',            'DEDUCTION',         true,  20],
        ['2.1',   'Cancelamentos / Devolucoes',     'DEDUCTION',         false, 21],
        ['3',     'Custo dos Servicos Vendidos',    'COGS',              true,  30],
        ['3.1',   'Pecas e Insumos',                'COGS',              false, 31],
        ['3.2',   'Mao de Obra Direta',             'COGS',              false, 32],
        ['4',     'Despesas Operacionais',          'OPERATING_EXPENSE', true,  40],
        ['4.1',   'Aluguel',                        'OPERATING_EXPENSE', false, 41],
        ['4.2',   'Salarios e Encargos',            'OPERATING_EXPENSE', false, 42],
        ['4.3',   'Energia / Agua / Internet',      'OPERATING_EXPENSE', false, 43],
        ['4.4',   'Marketing e Publicidade',        'OPERATING_EXPENSE', false, 44],
        ['4.5',   'Software / SaaS',                'OPERATING_EXPENSE', false, 45],
        ['4.6',   'Combustivel / Veiculos',         'OPERATING_EXPENSE', false, 46],
        ['5',     'Impostos',                       'TAX',               true,  50],
        ['5.1',   'ISS',                            'TAX',               false, 51],
        ['5.2',   'PIS / COFINS',                   'TAX',               false, 52],
        ['5.3',   'IRPJ / CSLL',                    'TAX',               false, 53],
        ['5.4',   'Taxas Bancarias',                'TAX',               false, 54],
        ['6',     'Receitas / Despesas Financeiras','FINANCIAL',         true,  60],
        ['6.1',   'Juros Recebidos',                'FINANCIAL',         false, 61],
        ['6.2',   'Juros Pagos',                    'FINANCIAL',         false, 62],
        ['6.3',   'Taxas de Cartao / Gateway',      'FINANCIAL',         false, 63],
        ['7',     'Nao-Operacionais',               'NON_OPERATING',     true,  70],
        ['7.1',   'Venda de Ativo Imobilizado',     'NON_OPERATING',     false, 71],
      ];

      for (const [code, name, type, syn, ord] of chartSeed) {
        const result = await p.$executeRawUnsafe(`
          INSERT INTO accounts_chart
            (company_id, code, name, account_type, is_synthetic, display_order)
          VALUES
            ($1, $2, $3, $4::chart_account_type, $5, $6)
          ON CONFLICT (company_id, code) DO NOTHING
        `, 'pontualtech-001', code, name, type, syn, ord);
        if (result > 0) seeded++;
      }

      const cnt = await p.$queryRawUnsafe(
        `SELECT count(*)::int AS c FROM accounts_chart WHERE company_id = $1`,
        'pontualtech-001'
      );
      chartCount = cnt[0].c;
      diagState.chartCount = chartCount;
      diagState.seeded = seeded;
      diagState.notes = 'reached §8 seed';
      await writeDiag();
    }

    // 9. M-013: Dual-write trigger AR/AP → payments unified.
    //    Trigger AFTER INSERT/UPDATE em accounts_receivable e accounts_payable
    //    cria/atualiza row correspondente em payments com kind apropriado.
    //    Permite que código novo leia da `payments` unified enquanto AR/AP
    //    continuam funcionando. Backfill de rows existentes é decisão separada.
    //
    //    EXCEPTION-safe: falha no dual-write NÃO quebra operação principal.
    //    Idempotente via origin_type + origin_id como identidade.
    const arExists = await p.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='accounts_receivable'`
    );
    if (arExists.length > 0) {
      await p.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION dual_write_ar_to_payments() RETURNS trigger AS $fn$
        DECLARE
          v_kind payment_kind := 'RECEIVABLE';
          v_origin_type text := 'ACCOUNT_RECEIVABLE';
        BEGIN
          BEGIN
            IF TG_OP = 'INSERT' THEN
              -- Nova AR → cria row em payments (se ainda não existe pra mesmo origin)
              -- amount (legacy NOT NULL int) recebe total_amount; idempotency_key
              -- (NOT NULL UNIQUE legacy) recebe id pra unicidade.
              INSERT INTO payments (
                id, company_id, kind, status, customer_id,
                origin_type, origin_id,
                amount, idempotency_key,
                total_amount, paid_amount, issue_date, due_date,
                description, created_at, updated_at
              ) VALUES (
                NEW.id, NEW.company_id, v_kind, COALESCE(NEW.status, 'PENDING'),
                NEW.customer_id, v_origin_type, NEW.id,
                NEW.total_amount, 'ar:' || NEW.id,
                NEW.total_amount, COALESCE(NEW.received_amount, 0),
                CURRENT_DATE, NEW.due_date,
                COALESCE(NEW.description, '(AR)'), COALESCE(NEW.created_at, NOW()), COALESCE(NEW.updated_at, NOW())
              )
              ON CONFLICT (id) DO NOTHING;
            ELSIF TG_OP = 'UPDATE' THEN
              -- AR atualizado → propaga campos críticos pra payments
              UPDATE payments
                SET status = COALESCE(NEW.status, status),
                    total_amount = NEW.total_amount,
                    paid_amount = COALESCE(NEW.received_amount, paid_amount),
                    due_date = NEW.due_date,
                    description = NEW.description,
                    deleted_at = NEW.deleted_at,
                    updated_at = NOW()
              WHERE id = NEW.id;
            END IF;
          EXCEPTION WHEN OTHERS THEN
            PERFORM fn_record_trigger_failure('dual_write_ar_to_payments', to_jsonb(NEW), SQLERRM, SQLSTATE);
            RAISE WARNING 'dual_write_ar_to_payments failed for AR=%: % (%)',
              NEW.id, SQLERRM, SQLSTATE;
          END;
          RETURN NEW;
        END $fn$ LANGUAGE plpgsql SECURITY DEFINER;
      `);
      await p.$executeRawUnsafe(`DROP TRIGGER IF EXISTS trg_ar_dual_write ON accounts_receivable;`);
      await p.$executeRawUnsafe(`
        CREATE TRIGGER trg_ar_dual_write
          AFTER INSERT OR UPDATE ON accounts_receivable
          FOR EACH ROW EXECUTE FUNCTION dual_write_ar_to_payments();
      `);
    }

    const apExists = await p.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='accounts_payable'`
    );
    if (apExists.length > 0) {
      await p.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION dual_write_ap_to_payments() RETURNS trigger AS $fn$
        DECLARE
          v_kind payment_kind := 'PAYABLE';
          v_origin_type text := 'ACCOUNT_PAYABLE';
        BEGIN
          BEGIN
            IF TG_OP = 'INSERT' THEN
              -- AP precisa customer_id (NOT NULL legacy). Usa supplier_id como customer
              -- temporariamente (em payments unified, supplier_id é a info correta).
              -- amount + idempotency_key cobrem legacy NOT NULL.
              INSERT INTO payments (
                id, company_id, kind, status,
                customer_id, supplier_id, origin_type, origin_id,
                amount, idempotency_key,
                total_amount, paid_amount, issue_date, due_date,
                description, created_at, updated_at
              ) VALUES (
                NEW.id, NEW.company_id, v_kind, COALESCE(NEW.status, 'PENDING'),
                NEW.supplier_id, NEW.supplier_id, v_origin_type, NEW.id,
                NEW.total_amount, 'ap:' || NEW.id,
                NEW.total_amount, COALESCE(NEW.paid_amount, 0),
                CURRENT_DATE, NEW.due_date,
                COALESCE(NEW.description, '(AP)'),
                COALESCE(NEW.created_at, NOW()), COALESCE(NEW.updated_at, NOW())
              )
              ON CONFLICT (id) DO NOTHING;
            ELSIF TG_OP = 'UPDATE' THEN
              UPDATE payments
                SET status = COALESCE(NEW.status, status),
                    total_amount = NEW.total_amount,
                    paid_amount = COALESCE(NEW.paid_amount, paid_amount),
                    due_date = NEW.due_date,
                    description = COALESCE(NEW.description, description),
                    deleted_at = NEW.deleted_at,
                    updated_at = NOW()
              WHERE id = NEW.id;
            END IF;
          EXCEPTION WHEN OTHERS THEN
            PERFORM fn_record_trigger_failure('dual_write_ap_to_payments', to_jsonb(NEW), SQLERRM, SQLSTATE);
            RAISE WARNING 'dual_write_ap_to_payments failed for AP=%: % (%)',
              NEW.id, SQLERRM, SQLSTATE;
          END;
          RETURN NEW;
        END $fn$ LANGUAGE plpgsql SECURITY DEFINER;
      `);
      await p.$executeRawUnsafe(`DROP TRIGGER IF EXISTS trg_ap_dual_write ON accounts_payable;`);
      await p.$executeRawUnsafe(`
        CREATE TRIGGER trg_ap_dual_write
          AFTER INSERT OR UPDATE ON accounts_payable
          FOR EACH ROW EXECUTE FUNCTION dual_write_ap_to_payments();
      `);
    }

    // 10. M-009: índices auxiliares em tabelas legadas (accounts_receivable/payable)
    //    Acelera queries até a v2 ramp 100%. CREATE INDEX (sem CONCURRENTLY pra
    //    evitar IDX_INVALID em caso de timeout — tabelas têm < 1k rows em prod).
    //    IF NOT EXISTS torna idempotente.
    for (const [tbl, idxName, cols, where] of [
      ['accounts_receivable', 'idx_ar_company_status_due',
        '(company_id, status, due_date)', `WHERE deleted_at IS NULL`],
      ['accounts_receivable', 'idx_ar_overdue_scan',
        '(company_id, due_date)', `WHERE status='PENDENTE' AND deleted_at IS NULL`],
      ['accounts_payable', 'idx_ap_company_status_due',
        '(company_id, status, due_date)', `WHERE deleted_at IS NULL`],
      ['accounts_payable', 'idx_ap_overdue_scan',
        '(company_id, due_date)', `WHERE status='PENDENTE' AND deleted_at IS NULL`],
    ]) {
      const tblExists = await p.$queryRawUnsafe(
        `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
        tbl
      );
      if (!tblExists || tblExists.length === 0) continue;
      try {
        await p.$executeRawUnsafe(
          `CREATE INDEX IF NOT EXISTS ${idxName} ON ${tbl} ${cols} ${where}`
        );
      } catch (e) {
        console.warn(`[ensure-financeiro] WARN index ${idxName}: ${e.message}`);
      }
    }

    // 11. F-010 / RN-007: Pipeline AR/AP PAGO → fiscal_entries
    //     Trigger AFTER UPDATE OF status (e AFTER INSERT) cria lançamento
    //     contábil em fiscal_entries quando AR/AP transiciona pra PAGO.
    //     Heurística de chart_account_id por categoria (fallback root '1'/'4').
    //     Idempotente: NOT EXISTS check via metadata->>'origin_id'+origin_type.
    //     SECURITY DEFINER pra bypass RLS dentro do trigger (runs como dono).
    //     Falha do trigger NÃO bloqueia o UPDATE da AR/AP (BEGIN..EXCEPTION).
    let fiscalPipelineOk = false;
    let backfillCount = 0;
    diagState.notes = 'reached §11 fiscal pipeline gate';
    await writeDiag();
    if (feExists.length > 0 && acExists.length > 0 && arExists.length > 0) {
      try {
      // 11.1 Função heurística: dado company_id + categoria_module + categoria_name + tipo (AR|AP),
      //      retorna o melhor chart_account_id ou NULL se nenhum match.
      await p.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION fn_resolve_chart_account(
          p_company_id text,
          p_kind text,             -- 'AR' ou 'AP'
          p_cat_module text,
          p_cat_name text
        ) RETURNS text AS $fn$
        DECLARE
          v_account_id text;
          v_target_type text;
          v_default_code text;
        BEGIN
          IF p_kind = 'AR' THEN
            v_target_type := 'REVENUE';
            v_default_code := '1';   -- Receitas root
            -- Match por categoria.name (lower ILIKE) — sem unaccent pra não exigir extensão
            SELECT id INTO v_account_id FROM accounts_chart
             WHERE company_id = p_company_id
               AND account_type = 'REVENUE'::chart_account_type
               AND is_active = true
               AND lower(name) ILIKE '%' || lower(coalesce(p_cat_name, '')) || '%'
             ORDER BY is_synthetic ASC, display_order ASC LIMIT 1;
          ELSE -- AP
            IF p_cat_module = 'custo' OR
               coalesce(lower(p_cat_name), '') ILIKE '%custo%' OR
               coalesce(lower(p_cat_name), '') ILIKE '%mercadoria%' OR
               coalesce(lower(p_cat_name), '') ILIKE '%materia%' OR
               coalesce(lower(p_cat_name), '') ILIKE '%insumo%' OR
               coalesce(lower(p_cat_name), '') ILIKE '%peca%' THEN
              v_target_type := 'COGS';
              v_default_code := '3';
            ELSE
              v_target_type := 'OPERATING_EXPENSE';
              v_default_code := '4';
            END IF;
            SELECT id INTO v_account_id FROM accounts_chart
             WHERE company_id = p_company_id
               AND account_type = v_target_type::chart_account_type
               AND is_active = true
               AND lower(coalesce(name, '')) ILIKE '%' || lower(coalesce(p_cat_name, '')) || '%'
             ORDER BY is_synthetic ASC, display_order ASC LIMIT 1;
          END IF;

          -- Fallback: pega o synthetic root do tipo
          IF v_account_id IS NULL THEN
            SELECT id INTO v_account_id FROM accounts_chart
             WHERE company_id = p_company_id
               AND code = v_default_code
               AND is_active = true LIMIT 1;
          END IF;

          RETURN v_account_id;
        END;
        $fn$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
      `);

      // (unaccent removido — fn_resolve_chart_account usa lower() ILIKE direto)

      // 11.2 Trigger AR PAGO → fiscal_entries
      await p.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION fn_ar_to_fiscal_entry() RETURNS trigger AS $fn$
        DECLARE
          v_chart_id text;
          v_cat_module text;
          v_cat_name text;
          v_amount bigint;
          v_entry_date date;
          v_cash_date date;
        BEGIN
          BEGIN
            -- AR usa status='RECEBIDO' (canônico) ou ocasionalmente 'PAGO'
            IF NEW.status NOT IN ('RECEBIDO', 'PAGO') THEN RETURN NEW; END IF;
            IF TG_OP = 'UPDATE' AND OLD.status IN ('RECEBIDO', 'PAGO') THEN RETURN NEW; END IF;

            -- Categoria info (left join)
            SELECT module, name INTO v_cat_module, v_cat_name
              FROM categories WHERE id = NEW.category_id;

            v_chart_id := fn_resolve_chart_account(NEW.company_id, 'AR', v_cat_module, v_cat_name);
            IF v_chart_id IS NULL THEN RETURN NEW; END IF;

            v_amount    := COALESCE(NEW.received_amount, NEW.total_amount, 0);
            v_entry_date := COALESCE(NEW.due_date::date, CURRENT_DATE);
            -- AR não tem paid_at — usa updated_at (proxy quando status='RECEBIDO')
            v_cash_date  := COALESCE(NEW.updated_at::date, NEW.due_date::date);

            INSERT INTO fiscal_entries (
              id, company_id, entry_date, cash_date, chart_account_id,
              amount, description, source, metadata, created_at
            )
            SELECT
              gen_random_uuid()::text, NEW.company_id, v_entry_date, v_cash_date, v_chart_id,
              v_amount, COALESCE(NEW.description, 'AR ' || NEW.id), 'PAYMENT',
              jsonb_build_object('origin_type', 'ACCOUNT_RECEIVABLE', 'origin_id', NEW.id),
              now()
            WHERE NOT EXISTS (
              SELECT 1 FROM fiscal_entries
               WHERE company_id = NEW.company_id
                 AND metadata->>'origin_type' = 'ACCOUNT_RECEIVABLE'
                 AND metadata->>'origin_id' = NEW.id
            );
          EXCEPTION WHEN OTHERS THEN
            -- Falha não-fatal: AR não trava. Registra em _trigger_failures pra
            -- visibilidade (RAISE NOTICE não aparece em log default).
            PERFORM fn_record_trigger_failure('fn_ar_to_fiscal_entry', to_jsonb(NEW), SQLERRM, SQLSTATE);
            RAISE NOTICE '[fn_ar_to_fiscal_entry] %', SQLERRM;
          END;
          RETURN NEW;
        END;
        $fn$ LANGUAGE plpgsql SECURITY DEFINER;
      `);

      await p.$executeRawUnsafe(`DROP TRIGGER IF EXISTS trg_ar_fiscal_entry ON accounts_receivable;`);
      await p.$executeRawUnsafe(`
        CREATE TRIGGER trg_ar_fiscal_entry
          AFTER INSERT OR UPDATE OF status, received_amount ON accounts_receivable
          FOR EACH ROW EXECUTE FUNCTION fn_ar_to_fiscal_entry();
      `);

      // 11.3 Trigger AP PAGO → fiscal_entries
      await p.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION fn_ap_to_fiscal_entry() RETURNS trigger AS $fn$
        DECLARE
          v_chart_id text;
          v_cat_module text;
          v_cat_name text;
          v_amount bigint;
          v_entry_date date;
          v_cash_date date;
        BEGIN
          BEGIN
            IF NEW.status <> 'PAGO' THEN RETURN NEW; END IF;
            IF TG_OP = 'UPDATE' AND OLD.status = 'PAGO' THEN RETURN NEW; END IF;

            SELECT module, name INTO v_cat_module, v_cat_name
              FROM categories WHERE id = NEW.category_id;

            v_chart_id := fn_resolve_chart_account(NEW.company_id, 'AP', v_cat_module, v_cat_name);
            IF v_chart_id IS NULL THEN RETURN NEW; END IF;

            v_amount    := COALESCE(NEW.paid_amount, NEW.total_amount, 0);
            v_entry_date := COALESCE(NEW.due_date::date, CURRENT_DATE);
            v_cash_date  := COALESCE(NEW.due_date::date, CURRENT_DATE);  -- AP não tem paid_at

            INSERT INTO fiscal_entries (
              id, company_id, entry_date, cash_date, chart_account_id,
              amount, description, source, metadata, created_at
            )
            SELECT
              gen_random_uuid()::text, NEW.company_id, v_entry_date, v_cash_date, v_chart_id,
              v_amount, COALESCE(NEW.description, 'AP ' || NEW.id), 'PAYMENT',
              jsonb_build_object('origin_type', 'ACCOUNT_PAYABLE', 'origin_id', NEW.id),
              now()
            WHERE NOT EXISTS (
              SELECT 1 FROM fiscal_entries
               WHERE company_id = NEW.company_id
                 AND metadata->>'origin_type' = 'ACCOUNT_PAYABLE'
                 AND metadata->>'origin_id' = NEW.id
            );
          EXCEPTION WHEN OTHERS THEN
            PERFORM fn_record_trigger_failure('fn_ap_to_fiscal_entry', to_jsonb(NEW), SQLERRM, SQLSTATE);
            RAISE NOTICE '[fn_ap_to_fiscal_entry] %', SQLERRM;
          END;
          RETURN NEW;
        END;
        $fn$ LANGUAGE plpgsql SECURITY DEFINER;
      `);

      await p.$executeRawUnsafe(`DROP TRIGGER IF EXISTS trg_ap_fiscal_entry ON accounts_payable;`);
      await p.$executeRawUnsafe(`
        CREATE TRIGGER trg_ap_fiscal_entry
          AFTER INSERT OR UPDATE OF status, paid_amount ON accounts_payable
          FOR EACH ROW EXECUTE FUNCTION fn_ap_to_fiscal_entry();
      `);

      // 11.4 Backfill idempotente: AR/AP PAGO → fiscal_entries
      // M11 fix (audit): fn_resolve_chart_account chamada UMA vez por row via
      // CTE em vez de duas (SELECT + WHERE). Função é STABLE — planner não
      // dedupe automaticamente. Em backfill com 1000 rows = 2000 chamadas
      // antes; agora 1000.
      const arBackfill = await p.$executeRawUnsafe(`
        WITH resolved AS (
          SELECT ar.*,
                 cat.module AS cat_module, cat.name AS cat_name,
                 fn_resolve_chart_account(ar.company_id, 'AR', cat.module, cat.name) AS chart_id
            FROM accounts_receivable ar
            LEFT JOIN categories cat ON cat.id = ar.category_id
           WHERE ar.status IN ('RECEBIDO', 'PAGO')
             AND ar.deleted_at IS NULL
        )
        INSERT INTO fiscal_entries (
          id, company_id, entry_date, cash_date, chart_account_id,
          amount, description, source, metadata, created_at
        )
        SELECT
          gen_random_uuid()::text, r.company_id,
          COALESCE(r.due_date::date, CURRENT_DATE),
          COALESCE(r.updated_at::date, r.due_date::date),
          r.chart_id,
          COALESCE(r.received_amount, r.total_amount, 0),
          COALESCE(r.description, 'AR ' || r.id),
          'PAYMENT',
          jsonb_build_object('origin_type','ACCOUNT_RECEIVABLE','origin_id', r.id),
          now()
          FROM resolved r
         WHERE r.chart_id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM fiscal_entries fe
              WHERE fe.company_id = r.company_id
                AND fe.metadata->>'origin_type' = 'ACCOUNT_RECEIVABLE'
                AND fe.metadata->>'origin_id' = r.id
           )
      `);
      const apBackfill = await p.$executeRawUnsafe(`
        WITH resolved AS (
          SELECT ap.*,
                 cat.module AS cat_module, cat.name AS cat_name,
                 fn_resolve_chart_account(ap.company_id, 'AP', cat.module, cat.name) AS chart_id
            FROM accounts_payable ap
            LEFT JOIN categories cat ON cat.id = ap.category_id
           WHERE ap.status = 'PAGO'
             AND ap.deleted_at IS NULL
        )
        INSERT INTO fiscal_entries (
          id, company_id, entry_date, cash_date, chart_account_id,
          amount, description, source, metadata, created_at
        )
        SELECT
          gen_random_uuid()::text, r.company_id,
          COALESCE(r.due_date::date, CURRENT_DATE),
          COALESCE(r.due_date::date, CURRENT_DATE),
          r.chart_id,
          COALESCE(r.paid_amount, r.total_amount, 0),
          COALESCE(r.description, 'AP ' || r.id),
          'PAYMENT',
          jsonb_build_object('origin_type','ACCOUNT_PAYABLE','origin_id', r.id),
          now()
          FROM resolved r
         WHERE r.chart_id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM fiscal_entries fe
              WHERE fe.company_id = r.company_id
                AND fe.metadata->>'origin_type' = 'ACCOUNT_PAYABLE'
                AND fe.metadata->>'origin_id' = r.id
           )
      `);
      backfillCount = (Number(arBackfill) || 0) + (Number(apBackfill) || 0);

      // 11.5 REFRESH MV (CONCURRENTLY se houver dados; senão refresh normal)
      try {
        const feCount = await p.$queryRawUnsafe(`SELECT count(*)::int AS c FROM fiscal_entries`);
        if (feCount[0].c > 0) {
          await p.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY dre_monthly;`);
        }
      } catch (e) {
        // Em primeira refresh CONCURRENTLY pode falhar; tenta normal
        try { await p.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW dre_monthly;`); } catch {}
      }
      fiscalPipelineOk = true;
      diagState.fiscalPipelineOk = true;
      diagState.backfillCount = backfillCount;
      diagState.notes = 'reached §11.5 refresh MV';
      await writeDiag();
      } catch (e) {
        diagState.lastError = '§11: ' + (e.message || String(e)).slice(0, 500);
        diagState.notes = 'crashed in §11 fiscal pipeline';
        await writeDiag();
        console.error('[ensure-financeiro] §11 ERROR:', e.message);
      }
    }

    // 12. M-012: Backfill AR/AP → payments unified (gated por PONTUAL_BACKFILL_M012=1).
    //
    // Domínio:
    //   - accounts_receivable: lançamentos a receber (origem)
    //   - accounts_payable: lançamentos a pagar (origem)
    //   - payments LEGACY: pagamentos via gateway/cartão (vinculados a AR via receivable_id)
    //   - payments UNIFIED (M-002+): row por AR/AP via dual-write trigger M-013
    //
    // Estratégia segura (não-duplicativa):
    //   Para cada AR/AP que NÃO tem um payments row com (origin_type, origin_id)
    //   correspondente, INSERT idempotente seguindo o pattern M-013.
    //   payments LEGACY (com receivable_id mas sem origin_type) ficam intocados —
    //   eles continuam representando "pagamentos efetivos" enquanto AR/AP são "lançamentos".
    //   Sem colisão: M-013 usa AR.id == payments.id, então ON CONFLICT DO NOTHING.
    //
    // Idempotente: pode rodar N vezes, só insere o que falta.
    let m012BackfillAr = 0;
    let m012BackfillAp = 0;
    if (process.env.PONTUAL_BACKFILL_M012 === '1' && arExists.length > 0) {
      try {
        const arResult = await p.$executeRawUnsafe(`
          INSERT INTO payments (
            id, company_id, kind, status, customer_id,
            origin_type, origin_id,
            amount, idempotency_key,
            total_amount, paid_amount, issue_date, due_date,
            description, created_at, updated_at
          )
          SELECT
            ar.id, ar.company_id, 'RECEIVABLE'::payment_kind,
            COALESCE(ar.status, 'PENDING'),
            ar.customer_id, 'ACCOUNT_RECEIVABLE', ar.id,
            COALESCE(ar.total_amount, 0),
            'ar:' || ar.id,
            COALESCE(ar.total_amount, 0),
            COALESCE(ar.received_amount, 0),
            COALESCE(ar.created_at::date, CURRENT_DATE),
            COALESCE(ar.due_date, CURRENT_DATE),
            COALESCE(ar.description, 'AR ' || ar.id),
            COALESCE(ar.created_at, now()),
            COALESCE(ar.updated_at, now())
            FROM accounts_receivable ar
           WHERE ar.deleted_at IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM payments p
                WHERE p.origin_type = 'ACCOUNT_RECEIVABLE'
                  AND p.origin_id = ar.id
             )
          ON CONFLICT (id) DO NOTHING
        `);
        m012BackfillAr = Number(arResult) || 0;
      } catch (e) {
        console.warn(`[ensure-financeiro] M-012 AR backfill: ${e.message}`);
      }

      try {
        // Verifica se accounts_payable existe antes de tentar
        const apTbl = await p.$queryRawUnsafe(
          `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='accounts_payable'`
        );
        if (apTbl.length > 0) {
          // AP: payments.customer_id é NOT NULL (legacy). Reusa supplier_id em ambos,
          // mesmo padrão do trigger M-013 dual_write_ap_to_payments.
          const apResult = await p.$executeRawUnsafe(`
            INSERT INTO payments (
              id, company_id, kind, status,
              customer_id, supplier_id,
              origin_type, origin_id,
              amount, idempotency_key,
              total_amount, paid_amount, issue_date, due_date,
              description, created_at, updated_at
            )
            SELECT
              ap.id, ap.company_id, 'PAYABLE'::payment_kind,
              COALESCE(ap.status, 'PENDING'),
              ap.supplier_id, ap.supplier_id,
              'ACCOUNT_PAYABLE', ap.id,
              COALESCE(ap.total_amount, 0),
              'ap:' || ap.id,
              COALESCE(ap.total_amount, 0),
              COALESCE(ap.paid_amount, 0),
              COALESCE(ap.created_at::date, CURRENT_DATE),
              COALESCE(ap.due_date, CURRENT_DATE),
              COALESCE(ap.description, 'AP ' || ap.id),
              COALESCE(ap.created_at, now()),
              COALESCE(ap.updated_at, now())
              FROM accounts_payable ap
             WHERE ap.deleted_at IS NULL
               AND ap.supplier_id IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1 FROM payments p
                  WHERE p.origin_type = 'ACCOUNT_PAYABLE'
                    AND p.origin_id = ap.id
               )
            ON CONFLICT (id) DO NOTHING
          `);
          m012BackfillAp = Number(apResult) || 0;
        }
      } catch (e) {
        console.warn(`[ensure-financeiro] M-012 AP backfill: ${e.message}`);
      }
    }

    // Diag final
    diagState.m012Ar = m012BackfillAr;
    diagState.m012Ap = m012BackfillAp;
    diagState.notes = 'OK final';
    await writeDiag();

    console.log(`[ensure-financeiro] OK chart_accounts=${chartCount} seeded=${seeded} fiscalPipeline=${fiscalPipelineOk} backfill=${backfillCount} m012Ar=${m012BackfillAr} m012Ap=${m012BackfillAp}`);
    process.exit(0);
  } catch (e) {
    diagState.lastError = (e.message || String(e)).slice(0, 500);
    diagState.notes = 'CRASHED in main try';
    await writeDiag();
    console.error('[ensure-financeiro] FAILED:', e.message);
    process.exit(0);
  } finally {
    await p.$disconnect();
  }
})();
JS
