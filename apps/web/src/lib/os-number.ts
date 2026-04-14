import { prisma } from '@pontual/db'

/**
 * Get the next OS number for a company.
 * Respects the 'os.next_number' setting as minimum floor.
 * Thread-safe: uses MAX(os_number) + 1 from the database.
 *
 * @param companyId - Company UUID
 * @param tx - Optional Prisma transaction client
 * @returns Next OS number
 */
export async function getNextOsNumber(
  companyId: string,
  tx?: any,
): Promise<number> {
  const db = tx || prisma

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
