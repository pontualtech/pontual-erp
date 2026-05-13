-- ============================================================================
-- 20260513_marketing_triggers — Fase 2 CRM Marketing
--
-- Cria 2 triggers em PostgreSQL pra alimentar marketing_contacts a partir das
-- operações naturais do ERP, sem mexer em código TypeScript:
--
--   T1: customers (INSERT/UPDATE email|deleted_at|nome|fone|doc|person_type)
--        → UPSERT em marketing_contacts (com tags origin/segment/service)
--
--   T2: service_order_history (INSERT — registra transição de status da OS)
--        → atualiza tags stage:* em marketing_contacts do cliente
--
-- DESIGN PRINCIPLES:
-- 1. EXCEPTION WHEN OTHERS THEN RETURN NEW — nunca bloqueia operação ERP
--    (se trigger falha, OS/customer ainda são salvos).
-- 2. Idempotente: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.
-- 3. Sem RAISE NOTICE (silencioso em prod — debug via consulta direta).
-- 4. Usa email lower(trim()) pra normalizar; UPSERT via UNIQUE (company_id, email).
-- 5. NÃO altera valor de email/customer_id quando já existe em marketing_contacts
--    (preserva dados do import VHSys que já têm linkagem custom).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- TRIGGER 1: customers → marketing_contacts
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_customer_to_marketing_contact() RETURNS trigger AS $$
DECLARE
  v_email text;
  v_segment_tag text;
  v_name text;
  v_phone text;
BEGIN
  v_email := lower(trim(coalesce(NEW.email, '')));

  -- Sem email ou customer deletado → não sincroniza
  IF v_email = '' OR v_email NOT LIKE '%@%' OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_segment_tag := CASE
    WHEN NEW.person_type = 'JURIDICA' THEN 'segment:b2b'
    WHEN NEW.person_type = 'FISICA'   THEN 'segment:b2c'
    ELSE 'segment:desconhecido'
  END;

  v_name  := coalesce(NEW.trade_name, NEW.legal_name);
  v_phone := coalesce(NEW.mobile, NEW.phone);

  INSERT INTO marketing_contacts (
    id, company_id, email, name, phone, document_number,
    customer_id, origin, tags,
    first_seen_at, last_seen_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid()::text,
    NEW.company_id,
    v_email,
    v_name,
    v_phone,
    NEW.document_number,
    NEW.id,
    'erp_auto',
    ARRAY['origin:erp_auto', 'service:impressora', v_segment_tag],
    now(), now(), now(), now()
  )
  ON CONFLICT (company_id, email) DO UPDATE SET
    -- Só preenche campo se estiver vazio no marketing_contact (não sobrescreve)
    customer_id     = COALESCE(marketing_contacts.customer_id, EXCLUDED.customer_id),
    name            = COALESCE(NULLIF(marketing_contacts.name, ''), EXCLUDED.name),
    phone           = COALESCE(NULLIF(marketing_contacts.phone, ''), EXCLUDED.phone),
    document_number = COALESCE(NULLIF(marketing_contacts.document_number, ''), EXCLUDED.document_number),
    last_seen_at    = now(),
    updated_at      = now(),
    -- Merge tags: união sem duplicar
    tags = (
      SELECT array_agg(DISTINCT t ORDER BY t)
      FROM unnest(marketing_contacts.tags || EXCLUDED.tags) t
    );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Nunca bloquear INSERT/UPDATE de customer por causa do sync de marketing
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_customer_to_marketing ON customers;
CREATE TRIGGER trg_sync_customer_to_marketing
  AFTER INSERT OR UPDATE OF
    email, deleted_at, mobile, phone, document_number,
    trade_name, legal_name, person_type
  ON customers
  FOR EACH ROW
  EXECUTE FUNCTION sync_customer_to_marketing_contact();


-- ----------------------------------------------------------------------------
-- TRIGGER 2: service_order_history → marketing_contacts.tags (stage:*)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_os_status_to_marketing_tag() RETURNS trigger AS $$
DECLARE
  v_email       text;
  v_company_id  text;
  v_customer_id text;
  v_status_name text;
  v_new_tag     text;
BEGIN
  -- Busca email do customer + company da OS
  SELECT lower(trim(c.email)), so.company_id, c.id
  INTO v_email, v_company_id, v_customer_id
  FROM service_orders so
  JOIN customers c ON c.id = so.customer_id
  WHERE so.id = NEW.service_order_id;

  IF v_email IS NULL OR v_email = '' OR v_email NOT LIKE '%@%' THEN
    RETURN NEW;
  END IF;

  -- Nome do status novo
  SELECT name INTO v_status_name FROM module_statuses WHERE id = NEW.to_status_id;

  -- Mapear nome do status → tag stage:*
  v_new_tag := CASE
    WHEN v_status_name IN ('Aprovado', 'Coletar', 'Entregar Reparado')
      THEN 'stage:cliente_em_servico'
    WHEN v_status_name IN ('Aguardando Aprovacao', 'Orcar', 'LAUDO', 'Aguardando Peca')
      THEN 'stage:lead_aguardando'
    WHEN v_status_name IN ('Renegociar', 'Aguardando Aprovacao Recalculado', 'Orcar Negociar')
      THEN 'stage:em_negociacao'
    WHEN v_status_name = 'Entregue'
      THEN 'stage:cliente_atendido'
    WHEN v_status_name IN ('Entregue Recusado', 'Cancelada', 'Doada', 'Entregar Recusado')
      THEN 'stage:perdido_recusou'
    ELSE NULL
  END;

  IF v_new_tag IS NULL THEN
    RETURN NEW;
  END IF;

  -- Remove tags stage:* antigas e adiciona a nova (sem duplicar)
  UPDATE marketing_contacts
  SET
    tags = (
      SELECT array_agg(DISTINCT t ORDER BY t)
      FROM unnest(
        array(SELECT t FROM unnest(tags) t WHERE t NOT LIKE 'stage:%')
        || ARRAY[v_new_tag]
      ) t
    ),
    customer_id  = COALESCE(customer_id, v_customer_id),
    last_seen_at = now(),
    updated_at   = now()
  WHERE company_id = v_company_id
    AND email      = v_email;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_os_status_to_marketing ON service_order_history;
CREATE TRIGGER trg_sync_os_status_to_marketing
  AFTER INSERT ON service_order_history
  FOR EACH ROW
  EXECUTE FUNCTION sync_os_status_to_marketing_tag();
