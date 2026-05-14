-- ============================================================================
-- 20260514_marketing_segments — Fase 3 Wave 3
--
-- Tabela pra salvar filtros nomeados de marketing_contacts ("segmentos").
-- Compartilhada por company (todos admins da empresa veem todos os segmentos).
--
-- DESIGN:
-- - filters JSONB pra flexibilidade (filtros podem evoluir sem migration nova)
-- - contact_count cache + contact_count_updated_at pra evitar count() em cada list
-- - UNIQUE (company_id, name) pra evitar duplicação de nomes na mesma empresa
-- - ON DELETE CASCADE em company_id (se company sumir, segmentos vão junto)
-- ============================================================================

CREATE TABLE IF NOT EXISTS marketing_segments (
  id text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  filters jsonb NOT NULL DEFAULT '{}',
  contact_count integer,
  contact_count_updated_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_segments_company_name_uniq UNIQUE (company_id, name)
);

CREATE INDEX IF NOT EXISTS idx_marketing_segments_company ON marketing_segments(company_id);
CREATE INDEX IF NOT EXISTS idx_marketing_segments_created_at ON marketing_segments(company_id, created_at DESC);

-- Trigger updated_at automático (reusa função genérica trg_set_updated_at já existente)
DROP TRIGGER IF EXISTS trg_marketing_segments_updated_at ON marketing_segments;
CREATE TRIGGER trg_marketing_segments_updated_at
  BEFORE UPDATE ON marketing_segments
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
