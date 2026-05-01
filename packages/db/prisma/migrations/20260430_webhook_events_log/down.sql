-- ROLLBACK M-003 — drop webhook_events_log
-- Seguro enquanto não houver código escrevendo nela ainda.
DROP TABLE IF EXISTS webhook_events_log CASCADE;
