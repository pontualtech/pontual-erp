-- M-001 ROLLBACK — Remove enum types criados em up.sql
--
-- IMPORTANTE: só roda com segurança ENQUANTO não houver tabelas/colunas usando esses tipos.
-- A partir da M-002 (que cria payments com colunas tipadas), executar este down.sql exige
-- ALTER TABLE primeiro pra remover dependências.
--
-- Para rollback DURANTE Sprint 1 antes de M-002 ser aplicada: este script é seguro.
-- Para rollback APÓS M-002: usar rollback de M-002 antes deste.

DROP TYPE IF EXISTS feature_flag_strategy;
DROP TYPE IF EXISTS reconciliation_status;
DROP TYPE IF EXISTS chart_account_type;
DROP TYPE IF EXISTS reminder_status;
DROP TYPE IF EXISTS reminder_channel;
DROP TYPE IF EXISTS webhook_event_status;
DROP TYPE IF EXISTS payment_provider;
DROP TYPE IF EXISTS payment_method_kind;
DROP TYPE IF EXISTS payment_status;
DROP TYPE IF EXISTS payment_kind;
