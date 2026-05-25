-- Multi-channel CLIDs: Meta (fbclid), LinkedIn (li_fat_id), X (twclid), TikTok (ttclid)
-- 2026-05-25. Decisão Karlão: vai expandir investimento pra Meta + LinkedIn + X + Email.
-- Sem essas colunas, captura ficava só em Google/Microsoft Ads.

ALTER TABLE marketing_whatsapp_redirects
  ADD COLUMN IF NOT EXISTS fbclid    TEXT,
  ADD COLUMN IF NOT EXISTS li_fat_id TEXT,
  ADD COLUMN IF NOT EXISTS twclid    TEXT,
  ADD COLUMN IF NOT EXISTS ttclid    TEXT;

COMMENT ON COLUMN marketing_whatsapp_redirects.fbclid    IS 'Meta (Facebook/Instagram) Ads click ID — fbclid';
COMMENT ON COLUMN marketing_whatsapp_redirects.li_fat_id IS 'LinkedIn Ads first-party tracking ID — li_fat_id';
COMMENT ON COLUMN marketing_whatsapp_redirects.twclid    IS 'X (Twitter) Ads click ID — twclid';
COMMENT ON COLUMN marketing_whatsapp_redirects.ttclid    IS 'TikTok Ads click ID — ttclid';
