-- Auditoria 03/09/2026 (NF 211): o nfeProc autorizado (NFe assinada + protNFe)
-- nao era persistido em lugar nenhum — obrigacao legal de guarda de 5 anos.
-- Coluna preenchida pelo nfe-emitir quando a SEFAZ autoriza (cStat 100).
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS xml_content TEXT;
