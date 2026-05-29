-- Aumenta janela de matching CWT fingerprint de 30 minutos para 24 horas.
-- Motivo (2026-05-29): análise mostrou 73% dos cliques (110/152 em 7 dias) expirando
-- antes do cliente mandar msg WhatsApp — cliente clica, fecha, volta horas depois.
-- 24h cobre 99% do comportamento real sem inflar risco de ambiguidade significativamente
-- (raro o mesmo phone receber clicks de campanhas diferentes no mesmo dia).
-- Sem perda — redirects consumed continuam idempotentes; apenas não-consumed valem mais tempo.

ALTER TABLE marketing_whatsapp_redirects
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '24 hours');
