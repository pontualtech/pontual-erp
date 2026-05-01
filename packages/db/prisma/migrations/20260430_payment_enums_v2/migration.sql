-- M-001 — Cria enum types do refactor financeiro v2 (Sprint 1)
--
-- Endereça pain point P-017 (magic numbers em status — strings hardcoded em 30+ pontos).
-- Esta migration é READ-ONLY para dados existentes: APENAS adiciona tipos novos no
-- catálogo do Postgres. Nenhuma tabela ou linha existente é alterada.
--
-- Enums usados a partir da M-002 (criação da tabela `payments` v2).
-- Spec completa: squads/financeiro-restructure-spec/output/architecture-spec.md §1.2
-- Plano de migração: squads/financeiro-restructure-spec/output/migration-plan.md M-001
--
-- Risco: BAIXO (CREATE TYPE é idempotente quando combinado com IF NOT EXISTS via DO block).
-- Tempo: < 5s.
-- Rollback: DROP TYPE em ordem reversa (down.sql neste mesmo diretório).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_kind') THEN
    CREATE TYPE payment_kind AS ENUM ('RECEIVABLE','PAYABLE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
    CREATE TYPE payment_status AS ENUM (
      'PENDING','OVERDUE','PARTIAL','PAID','CANCELLED','REFUNDED','DISPUTED'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_method_kind') THEN
    CREATE TYPE payment_method_kind AS ENUM (
      'PIX','BOLETO','CREDIT_CARD','DEBIT_CARD','CASH','BANK_TRANSFER','OTHER'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_provider') THEN
    CREATE TYPE payment_provider AS ENUM (
      'ASAAS','INTER_CNAB','REDE','MANUAL','INTERNAL'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'webhook_event_status') THEN
    CREATE TYPE webhook_event_status AS ENUM (
      'RECEIVED','PROCESSING','PROCESSED','FAILED','IGNORED'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reminder_channel') THEN
    CREATE TYPE reminder_channel AS ENUM ('EMAIL','WHATSAPP','SMS');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reminder_status') THEN
    CREATE TYPE reminder_status AS ENUM ('PENDING','SENT','FAILED','SKIPPED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'chart_account_type') THEN
    CREATE TYPE chart_account_type AS ENUM (
      'REVENUE','DEDUCTION','COGS','OPERATING_EXPENSE','TAX','FINANCIAL','NON_OPERATING'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reconciliation_status') THEN
    CREATE TYPE reconciliation_status AS ENUM (
      'PENDING','AUTO_MATCHED','MANUAL_MATCHED','UNMATCHED','IGNORED'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'feature_flag_strategy') THEN
    CREATE TYPE feature_flag_strategy AS ENUM ('OFF','ON','PERCENTAGE','TENANT_LIST');
  END IF;
END $$;
