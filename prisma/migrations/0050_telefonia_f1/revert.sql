-- ============================================================================
-- ROLLBACK Migration 0050_telefonia_f1
-- ============================================================================
-- Aplicar APÓS marcar como rolled-back no _prisma_migrations:
--   npx prisma migrate resolve --rolled-back 0050_telefonia_f1
--   psql "$DATABASE_URL" -f prisma/migrations/0050_telefonia_f1/revert.sql
-- ============================================================================

BEGIN;

-- 1) Drop policies (super admin first, depois tenant)
DROP POLICY IF EXISTS "voip_audit_log_superadmin"        ON "voip_audit_log";
DROP POLICY IF EXISTS "voip_presence_superadmin"         ON "voip_presence";
DROP POLICY IF EXISTS "voip_inbound_numbers_superadmin"  ON "voip_inbound_numbers";
DROP POLICY IF EXISTS "voip_extensions_superadmin"       ON "voip_extensions";
DROP POLICY IF EXISTS "voip_providers_superadmin"        ON "voip_providers";

DROP POLICY IF EXISTS "voip_audit_log_tenant"            ON "voip_audit_log";
DROP POLICY IF EXISTS "voip_presence_tenant"             ON "voip_presence";
DROP POLICY IF EXISTS "voip_inbound_numbers_tenant"      ON "voip_inbound_numbers";
DROP POLICY IF EXISTS "voip_extensions_tenant"           ON "voip_extensions";
DROP POLICY IF EXISTS "voip_providers_tenant"            ON "voip_providers";

-- 2) Drop tables (ordem reversa de FK)
DROP TABLE IF EXISTS "voip_audit_log"        CASCADE;
DROP TABLE IF EXISTS "voip_presence"         CASCADE;
DROP TABLE IF EXISTS "voip_inbound_numbers"  CASCADE;
DROP TABLE IF EXISTS "voip_extensions"       CASCADE;
DROP TABLE IF EXISTS "voip_providers"        CASCADE;

-- 3) Drop enums
DROP TYPE IF EXISTS "voip_extension_status";
DROP TYPE IF EXISTS "voip_auth_method";

COMMIT;

-- Verificação manual pós-rollback:
--   psql "$DATABASE_URL" -c "\dt voip_*"             -> 0 linhas
--   psql "$DATABASE_URL" -c "\dT voip_*"             -> 0 linhas