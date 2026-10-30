-- Vínculo da baixa (AR/AP) com o lançamento do livro-razão. Aditivo, nullable.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS linked_ref TEXT;
CREATE INDEX IF NOT EXISTS transactions_linked_ref_idx ON transactions(linked_ref);
