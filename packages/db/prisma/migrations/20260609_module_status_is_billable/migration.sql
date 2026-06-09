-- Flag is_billable em module_statuses: status com false NÃO gera AR
-- (financeiro) nem abre modal de pagamento na transição da OS. Substitui
-- heurística regex /cancel|recusad/i em 3 lugares (transition, page OS,
-- dashboard stats), que era frágil e foi revertida em 02/06 (commit
-- 294b0b2d) por motivo desconhecido. Solução robusta via flag explícita.
--
-- Backfill: marca como false statuses já existentes que conhecemos:
--   * Cancel*  (Cancelada, Cancelado)
--   * *Recusad* (Entregar Recusado, Entregue Recusado, RETIRADA RECUSADA)
--   * Doada / Doado / Doadas / Doados
--   * Imprimitech (status handoff cross-tenant PT → IMP — cobra do lado IMP)
--
-- Default true: statuses não mapeados (e novos) ficam cobráveis. Admin
-- desmarca via UI /config/status (checkbox "Gera cobrança ao concluir").
--
-- Idempotente: IF NOT EXISTS + WHERE só toca linhas relevantes.

ALTER TABLE module_statuses
  ADD COLUMN IF NOT EXISTS is_billable BOOLEAN DEFAULT true;

UPDATE module_statuses
  SET is_billable = false
  WHERE module = 'os'
    AND (
      name ILIKE '%cancel%'
      OR name ILIKE '%recusad%'
      OR name ILIKE 'doad%'
      OR name = 'Imprimitech'
    )
    AND is_billable IS NOT FALSE;
