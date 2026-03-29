-- Add require_read column to announcements
ALTER TABLE "announcements" ADD COLUMN "require_read" BOOLEAN DEFAULT false;

-- Create announcement_reads table
CREATE TABLE "announcement_reads" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "announcement_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "read_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_reads_pkey" PRIMARY KEY ("id")
);

-- Unique constraint: one read per user per announcement
CREATE UNIQUE INDEX "announcement_reads_announcement_id_user_id_key" ON "announcement_reads"("announcement_id", "user_id");

-- Index for querying user's unread announcements
CREATE INDEX "idx_announcement_reads_user" ON "announcement_reads"("user_id", "company_id");

-- Foreign key to announcements (cascade delete)
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
