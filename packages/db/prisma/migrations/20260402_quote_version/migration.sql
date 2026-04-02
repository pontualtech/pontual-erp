-- AlterTable: Add version column to quotes
ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
