-- Observability infrastructure (2026-05-21)
-- 3 tabelas pra capturar erros, snapshots de health e estado de alertas.
-- Idempotente: IF NOT EXISTS pra suportar re-run sem erro.
--
-- Estratégia: tabelas globais (sem company_id obrigatório) pra capturar
-- problemas de infra que afetam todos os tenants. error_logs aceita
-- company_id opcional pra erros em request com sessão autenticada.

-- 1. error_logs — captura de exceptions do handleError global
--
-- ts: quando o erro aconteceu (request time)
-- level: 'error' | 'warning' | 'info' (default error)
-- message: primeira linha da mensagem (max 500 chars no app)
-- stack: stack trace completo (text livre, sem limite)
-- context_json: { request_id, url, method, params, user_id, ip, ... }
-- user_id: UUID do user logado (null em endpoints públicos)
-- company_id: UUID do tenant (null em endpoints sem auth ou multi-tenant errado)
-- request_id: gerado pelo middleware (correlação com logs Coolify)
--
-- Indexes pensados pra queries da UI:
--   ORDER BY ts DESC (lista cronológica) — idx_error_logs_ts_desc
--   WHERE company_id = X ORDER BY ts DESC — idx_error_logs_company_ts
CREATE TABLE IF NOT EXISTS error_logs (
  id           TEXT        PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  ts           TIMESTAMPTZ NOT NULL DEFAULT now(),
  level        TEXT        NOT NULL DEFAULT 'error',
  message      TEXT        NOT NULL,
  stack        TEXT,
  context_json JSONB       NOT NULL DEFAULT '{}'::jsonb,
  user_id      TEXT,
  company_id   TEXT,
  request_id   TEXT
);

CREATE INDEX IF NOT EXISTS idx_error_logs_ts_desc
  ON error_logs (ts DESC);

CREATE INDEX IF NOT EXISTS idx_error_logs_company_ts
  ON error_logs (company_id, ts DESC)
  WHERE company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_error_logs_level_ts
  ON error_logs (level, ts DESC);

-- 2. health_snapshots — série temporal de /api/health snapshots
--
-- snapshot_at: quando foi tirado o snapshot (5min cadence típica)
-- status: 'ok' | 'critical' (mesmo enum do /api/health response)
-- elapsed_ms: tempo que /api/health levou pra executar
-- data_json: response inteiro do /api/health (db_latency_ms, webhook_events_stuck,
--   trigger_failures_1h, dre_mv_stale, fiscal_pipeline_ok, heap_used_mb, uptime_sec)
--
-- Retention: cron de limpeza apaga snapshots > 30 dias (não precisa série longa).
-- Query padrão: últimos 7d ORDER BY snapshot_at DESC → idx_health_snapshots_at_desc
CREATE TABLE IF NOT EXISTS health_snapshots (
  id          TEXT        PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status      TEXT        NOT NULL,
  elapsed_ms  INTEGER     NOT NULL,
  data_json   JSONB       NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_health_snapshots_at_desc
  ON health_snapshots (snapshot_at DESC);

CREATE INDEX IF NOT EXISTS idx_health_snapshots_status
  ON health_snapshots (status, snapshot_at DESC)
  WHERE status != 'ok';

-- 3. alert_state — anti-flood pra alertas (1 envio por tipo a cada 1h)
--
-- alert_type: 'db_down' | 'webhook_stuck' | 'trigger_failures' | 'latency_high' |
--             'memory_high' | 'fiscal_pipeline_fail' | etc
-- last_sent_at: última vez que esse tipo de alerta foi disparado
-- occurrence_count: quantas vezes detectamos (mesmo em cooldown) — pra debug
--
-- id próprio + UNIQUE (alert_type, company_id) — PostgreSQL não permite NULL
-- em PK composta. Sentinel '__global__' é usado pra alertas de infra (DB down
-- afeta todos os tenants). UNIQUE garante 1 row por par (type, tenant).
CREATE TABLE IF NOT EXISTS alert_state (
  id               TEXT        PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  alert_type       TEXT        NOT NULL,
  company_id       TEXT        NOT NULL DEFAULT '__global__',
  last_sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  occurrence_count INTEGER     NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_state_type_company
  ON alert_state (alert_type, company_id);
