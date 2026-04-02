/**
 * Migration: Advanced Stock Module
 * Creates suppliers, purchases, purchase_items tables
 * Adds new columns to products table
 *
 * Run: node migrate-stock-advanced.js
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  console.log('[migrate] Starting Advanced Stock module migration...')

  // Suppliers table
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      company_id TEXT NOT NULL,
      name TEXT NOT NULL,
      document TEXT,
      contact_name TEXT,
      phone TEXT,
      email TEXT,
      avg_delivery_days INT,
      notes TEXT,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  console.log('[migrate] ✓ suppliers table')

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_suppliers_company ON suppliers(company_id)
  `)

  // Purchases table
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      company_id TEXT NOT NULL,
      supplier_id TEXT REFERENCES suppliers(id),
      number TEXT,
      status TEXT DEFAULT 'DRAFT',
      nfe_key TEXT,
      total INT DEFAULT 0,
      expected_delivery DATE,
      received_at TIMESTAMPTZ,
      notes TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  console.log('[migrate] ✓ purchases table')

  // Purchase items
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS purchase_items (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      purchase_id TEXT REFERENCES purchases(id),
      product_id TEXT,
      description TEXT,
      quantity INT NOT NULL,
      unit_cost INT NOT NULL,
      total INT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  console.log('[migrate] ✓ purchase_items table')

  // Add columns to products if not exist
  const alterStatements = [
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_price INT DEFAULT 0`,
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS min_stock INT DEFAULT 0`,
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS max_stock INT`,
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS reorder_point INT`,
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_id TEXT`,
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS location TEXT`,
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS last_purchase_date DATE`,
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS avg_cost INT DEFAULT 0`,
  ]

  for (const stmt of alterStatements) {
    try {
      await prisma.$executeRawUnsafe(stmt)
    } catch (err) {
      // Column may already exist — safe to ignore
      if (!err.message?.includes('already exists')) {
        console.warn('[migrate] Warning:', err.message)
      }
    }
  }
  console.log('[migrate] ✓ products columns updated')

  console.log('[migrate] Done! All Advanced Stock tables created.')
}

main()
  .catch((err) => {
    console.error('[migrate] FATAL:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
