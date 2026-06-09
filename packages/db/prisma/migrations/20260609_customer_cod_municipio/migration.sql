-- Customer.cod_municipio: codigo IBGE 7 digitos do municipio (ex: '3509205' Cajamar/SP).
-- Necessario pra emissao NF-e (campo <cMun> do destinatario no XML SEFAZ).
-- Quando cliente nao tem, emissao caia em fallback hardcoded '3550308' (Sao Paulo)
-- → SEFAZ rejeitava porque <cMun> e <xMun> ficavam inconsistentes.
--
-- Caso real 2026-06-09: NF Renner Sayerlack 937720 (retorno conserto CFOP 5916)
-- ficou em PROCESSING limbo porque destinatario Renner em Cajamar foi enviado com
-- cMun=3550308 (SP capital) ao inves de 3509205 (Cajamar). NF inexistente na
-- base SEFAZ nacional confirma que nao foi aceita.
--
-- Backfill: Renner 3509205 (Cajamar/SP), demais ficam null (UI vai pedir).
-- Idempotente: IF NOT EXISTS.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS cod_municipio TEXT;

UPDATE customers
  SET cod_municipio = '3509205'
  WHERE document_number = '61142865000691'
    AND cod_municipio IS NULL;
