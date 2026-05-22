-- whatsapp_redirects — fingerprint server-side de cliques no botão WhatsApp (2026-05-22)
--
-- Problema resolvido: a tag CWT injeta [ref:...] no text= do wa.me, mas clientes
-- frequentemente APAGAM o texto pré-preenchido e digitam o próprio. Cobertura medida
-- em produção: ~0.3% das conversas preservam o ref.
--
-- Solução: tag CWT envia POST pra /api/marketing/whatsapp-redirect ANTES de redirecionar
-- pro wa.me, gravando snapshot {gclid, utm_*, phone_destination, click_at}. Quando bot
-- Marta/Ana/Aline/Grazi recebe mensagem nova SEM [ref:...], busca o redirect mais recente
-- pelo phone_destination dentro de janela de 30 min e atribui.
--
-- Cobertura esperada: 60-80% (vs 0.3% atual).
-- Trade-off: em pico de tráfego com vários clicks no mesmo número, ambiguidade.
--
-- TTL: redirects com expires_at < now() podem ser deletados por cron diário (não crítico).

CREATE TABLE IF NOT EXISTS marketing_whatsapp_redirects (
  id                  TEXT        PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  company_id          TEXT,                                       -- pode ser null se subdomínio não bater
  phone_destination   TEXT        NOT NULL,                       -- nosso número (ex: 5511965760126)
  click_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 minutes'),
  consumed_at         TIMESTAMPTZ,                                -- quando bot match no msg incoming
  consumed_by_conv_id INTEGER,                                    -- chatwoot_conv_id que consumiu

  -- Tracking parameters
  gclid               TEXT,
  msclkid             TEXT,
  gbraid              TEXT,
  utm_source          TEXT,
  utm_medium          TEXT,
  utm_campaign        TEXT,
  utm_term            TEXT,
  utm_content         TEXT,

  -- Contexto do click
  page_url            TEXT,
  referrer            TEXT,
  ip_hash             TEXT,                                       -- SHA-256(ip + salt) — privacidade LGPD
  user_agent          TEXT,
  button_position     TEXT,                                       -- ex: "hero", "footer", "floating"

  raw_payload         JSONB       DEFAULT '{}'::jsonb             -- catch-all pra debug
);

CREATE INDEX IF NOT EXISTS idx_mwr_destination_clickat
  ON marketing_whatsapp_redirects (phone_destination, click_at DESC)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_mwr_expires_at
  ON marketing_whatsapp_redirects (expires_at)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_mwr_company_clickat
  ON marketing_whatsapp_redirects (company_id, click_at DESC);

COMMENT ON TABLE  marketing_whatsapp_redirects IS 'CWT server-side fingerprint — pareia cliques no botão WhatsApp do site com mensagens entrantes no Chatwoot por janela temporal.';
COMMENT ON COLUMN marketing_whatsapp_redirects.phone_destination IS 'Número WhatsApp do destino (nosso número), digits-only sem +.';
COMMENT ON COLUMN marketing_whatsapp_redirects.consumed_at IS 'Set pelo bot quando match com msg incoming (lookup).';
COMMENT ON COLUMN marketing_whatsapp_redirects.ip_hash IS 'SHA-256(ip + WHATSAPP_REDIRECT_SALT). Não armazenar IP puro por LGPD.';
