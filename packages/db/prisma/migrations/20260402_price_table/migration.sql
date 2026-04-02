-- CreateTable
CREATE TABLE IF NOT EXISTS "price_table" (
  "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
  "company_id" TEXT NOT NULL,
  "equipment_type" TEXT,
  "brand" TEXT,
  "model_pattern" TEXT,
  "service_description" TEXT,
  "default_price" INTEGER DEFAULT 0,
  "estimated_time_minutes" INTEGER,
  "is_active" BOOLEAN DEFAULT true,
  "created_at" TIMESTAMPTZ(6) DEFAULT NOW(),

  CONSTRAINT "price_table_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_price_table_company" ON "price_table"("company_id");

-- AddForeignKey
ALTER TABLE "price_table" ADD CONSTRAINT "price_table_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
