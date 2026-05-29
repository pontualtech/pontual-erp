-- Idempotência do upload de cliques WhatsApp (CWT) como conversão pro Google Ads.
-- 2026-05-29: a conversão client-side de WhatsApp quebrou em 01/05 (Consent Mode passou a
-- bloquear ad_storage — clique vira conversão só se o usuário aceitar cookies, o que a maioria
-- não faz antes de clicar no WhatsApp). marketing_whatsapp_redirects já captura o clique+gclid
-- server-side, imune a consent. Esta coluna marca quais cliques já foram enviados ao Google Ads
-- via uploadClickConversions, pro cron upload-conversions não duplicar. NULL = ainda não enviado.
-- Puramente aditiva: nenhuma linha existente é alterada, nenhum default retroativo.

ALTER TABLE marketing_whatsapp_redirects
  ADD COLUMN IF NOT EXISTS gads_conversion_uploaded_at TIMESTAMPTZ;

COMMENT ON COLUMN marketing_whatsapp_redirects.gads_conversion_uploaded_at IS 'Timestamp do upload do clique como conversão ao Google Ads (NULL = pendente). Idempotência do cron upload-conversions.';
