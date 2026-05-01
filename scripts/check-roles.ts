/**
 * Verifica roles necessários no Postgres antes de aplicar M-003.
 * One-shot.
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const roles = await prisma.$queryRaw<{ rolname: string }[]>`
    SELECT rolname FROM pg_roles
     WHERE rolname IN ('service_role', 'authenticated', 'anon', 'supabase_admin')
     ORDER BY rolname
  `
  console.log('Roles encontrados:')
  for (const r of roles) console.log(`  ${r.rolname}`)

  // Tabelas com nome similar pra evitar conflito
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
     WHERE schemaname='public' AND tablename ILIKE '%webhook%'
     ORDER BY tablename
  `
  console.log('\nTabelas webhook existentes:')
  for (const t of tables) console.log(`  ${t.tablename}`)
}

main().catch(console.error).finally(() => prisma.$disconnect())
