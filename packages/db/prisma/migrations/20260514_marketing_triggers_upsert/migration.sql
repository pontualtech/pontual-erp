-- ============================================================================
-- 20260514_marketing_triggers_upsert
--
-- Fix gap descoberto no health check pós-Fase 2: customers cujo email ainda
-- não estava em marketing_contacts (1.838/4.071 vinculados, 2.233 órfãos)
-- nunca recebiam tag stage:* porque o trigger T2 apenas fazia UPDATE.
--
-- Mudança: trigger T2 agora faz UPSERT — se contato não existe em
-- marketing_contacts, cria com origin:erp_auto + segment:b2c|b2b +
-- service:impressora + stage:X. Se existe, atualiza tag stage:* (igual antes).
--
-- Trigger T1 (customers→marketing) NÃO muda — continua disparando em
-- AFTER INSERT/UPDATE em customers e fazendo seu próprio UPSERT.
--
-- Idempotente: CREATE OR REPLACE FUNCTION. Não precisa DROP TRIGGER.
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_os_status_to_marketing_tag() RETURNS trigger AS $$
DECLARE
  v_email        text;
  v_company_id   text;
  v_customer_id  text;
  v_person_type  text;
  v_name         text;
  v_phone        text;
  v_doc          text;
  v_status_name  text;
  v_new_tag      text;
  v_segment_tag  text;
BEGIN
  -- Busca dados do customer + company da OS
  SELECT
    lower(trim(c.email)),
    so.company_id,
    c.id,
    c.person_type,
    coalesce(c.trade_name, c.legal_name),
    coalesce(c.mobile, c.phone),
    c.document_number
  INTO
    v_email, v_company_id, v_customer_id, v_person_type, v_name, v_phone, v_doc
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

  v_segment_tag := CASE
    WHEN v_person_type = 'JURIDICA' THEN 'segment:b2b'
    WHEN v_person_type = 'FISICA'   THEN 'segment:b2c'
    ELSE 'segment:desconhecido'
  END;

  -- UPSERT: cria contato se não existe, ou atualiza tags se existe
  INSERT INTO marketing_contacts (
    id, company_id, email, name, phone, document_number,
    customer_id, origin, tags,
    first_seen_at, last_seen_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid()::text,
    v_company_id,
    v_email,
    v_name,
    v_phone,
    v_doc,
    v_customer_id,
    'erp_auto',
    ARRAY['origin:erp_auto', 'service:impressora', v_segment_tag, v_new_tag],
    now(), now(), now(), now()
  )
  ON CONFLICT (company_id, email) DO UPDATE SET
    -- Remove tags stage:* antigas e adiciona a nova (sem duplicar resto das tags)
    tags = (
      SELECT array_agg(DISTINCT t ORDER BY t)
      FROM unnest(
        array(SELECT t FROM unnest(marketing_contacts.tags) t WHERE t NOT LIKE 'stage:%')
        || ARRAY[v_new_tag]
      ) t
    ),
    customer_id  = COALESCE(marketing_contacts.customer_id, EXCLUDED.customer_id),
    last_seen_at = now(),
    updated_at   = now();

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Nunca bloquear OS por causa do sync de marketing
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger continua o mesmo (já existe), só a função mudou via CREATE OR REPLACE.
