import { prisma } from '@pontual/db'

/**
 * UX-10 #7: gerar próximo número de OS atomicamente para evitar UNIQUE
 * collision quando 2 atendentes/motoristas criam OS simultâneos.
 *
 * Estratégia: pg_advisory_xact_lock por company_id (releaseado no COMMIT
 * automaticamente). Lock só protege a leitura de MAX — ser rápido.
 * MUST ser chamado dentro de prisma.$transaction caller.
 */
export async function getNextOsNumber(
  companyId: string,
  tx?: any,
): Promise<number> {
  const db = tx || prisma

  // UX-10 #7: lock xact-level — segurança contra race "MAX seguido de INSERT"
  // Funciona dentro de tx; fora de tx, advisory_xact_lock vira advisory_lock
  // efêmero (libera no fim do statement). Caller idealmente passa tx.
  await db.$queryRaw`
    SELECT pg_advisory_xact_lock(hashtext('os.next_number:' || ${companyId})::bigint)
  `

  // Get the configured minimum from settings
  const minSetting = await db.setting.findUnique({
    where: { company_id_key: { company_id: companyId, key: 'os.next_number' } },
  })
  const configuredMin = parseInt(minSetting?.value || '1', 10) || 1

  // Get the actual max from service_orders
  const result = await db.$queryRaw<{ n: number }[]>`
    SELECT COALESCE(MAX(os_number), 0) + 1 as n
    FROM service_orders
    WHERE company_id = ${companyId}
  `
  const dbNext = Number(result[0]?.n) || 1

  // Return the higher of the two
  return Math.max(dbNext, configuredMin)
}
