-- ROLLBACK M-004 — remove trigger, function e tabela payment_history.
-- Seguro a qualquer momento. payment_history pode acumular rows depois;
-- DROP TABLE CASCADE remove FKs (payment_history → payments com ON DELETE CASCADE).

BEGIN;

DROP TRIGGER IF EXISTS trg_payments_audit ON payments;
DROP FUNCTION IF EXISTS payment_history_trigger();
DROP TABLE IF EXISTS payment_history CASCADE;

COMMIT;
