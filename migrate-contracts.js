/**
 * Migração — Criação das tabelas de Contratos e Manutenção Preventiva
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('[CONTRACTS] Creating tables...');

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS contracts (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      company_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      number TEXT,
      description TEXT,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      monthly_value INT DEFAULT 0,
      billing_day INT DEFAULT 1,
      visit_frequency TEXT DEFAULT 'MONTHLY',
      max_visits_per_period INT,
      status TEXT DEFAULT 'ACTIVE',
      auto_renew BOOLEAN DEFAULT false,
      renewal_alert_days INT DEFAULT 30,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('[CONTRACTS] contracts table created');

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS contract_equipment (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      contract_id TEXT REFERENCES contracts(id),
      equipment_type TEXT,
      brand TEXT,
      model TEXT,
      serial_number TEXT,
      location TEXT,
      last_maintenance DATE,
      next_maintenance DATE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('[CONTRACTS] contract_equipment table created');

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS contract_visits (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      company_id TEXT NOT NULL,
      contract_id TEXT REFERENCES contracts(id),
      os_id TEXT,
      visit_date DATE,
      type TEXT DEFAULT 'PREVENTIVE',
      status TEXT DEFAULT 'SCHEDULED',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('[CONTRACTS] contract_visits table created');

  // Indexes
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_contracts_company ON contracts(company_id);`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_contracts_customer ON contracts(customer_id);`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_contract_equip ON contract_equipment(contract_id);`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_contract_visits ON contract_visits(contract_id);`);
  console.log('[CONTRACTS] Indexes created');

  console.log('[CONTRACTS] Migration complete!');
}

main()
  .catch(e => {
    console.error('[CONTRACTS] Migration failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
