-- Rollback manual da migration 20260513_marketing_triggers
-- Execute via psql se precisar desativar os triggers SEM perder marketing_contacts.

DROP TRIGGER IF EXISTS trg_sync_customer_to_marketing ON customers;
DROP TRIGGER IF EXISTS trg_sync_os_status_to_marketing ON service_order_history;

DROP FUNCTION IF EXISTS sync_customer_to_marketing_contact();
DROP FUNCTION IF EXISTS sync_os_status_to_marketing_tag();

-- Para restaurar marketing_contacts a partir do backup JSON:
--   node restore_marketing_contacts.js
-- (carrega BACKUP_marketing_contacts_2026-05-13_pre-triggers.json e faz TRUNCATE+INSERT)
