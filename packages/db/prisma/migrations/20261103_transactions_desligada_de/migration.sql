-- Linha do banco desligada (estorno/Desfazer) lembra a conta (AR:<id>/AP:<id>) que pagava. Aditivo, nullable:
-- o código anterior ignora a coluna.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS desligada_de TEXT;
