import { prisma } from '@pontual/db'
import { createHash } from 'crypto'

/**
 * N5 fix (audit pos-fix): Postgres advisory lock pra crons multi-instance.
 *
 * setInterval no instrumentation.ts dispara fetch a cada N min. Em deploy
 * single-pod funciona. Em deploy 2+ réplicas, todos os crons rodam N vezes
 * em paralelo — cliente recebe 2x cobrança/lembrete/etc.
 *
 * Solução: cada endpoint cron adquire advisory lock no início. Se não
 * conseguir (outra réplica está rodando), retorna 200 skipped — não falha.
 *
 * Uso:
 *   const acquired = await withAdvisoryLock('cron:bot-followup', async () => {
 *     // job real
 *   })
 *   if (!acquired) return success({ skipped: true, reason: 'concurrent run' })
 *
 * Lock libera automaticamente no COMMIT/ROLLBACK da transaction interna.
 */
export async function withAdvisoryLock<T>(
  lockName: string,
  fn: () => Promise<T>,
): Promise<{ acquired: true; result: T } | { acquired: false }> {
  // Hash do nome → bigint pg_try_advisory_lock(int8)
  const hash = createHash('sha256').update(lockName).digest()
  // Pega 8 bytes como bigint signed
  const lockKey = hash.readBigInt64BE(0)

  return prisma.$transaction(async (tx) => {
    // Sprint UX-27 audit: usar `AS acquired` explicito ao inves de
    // depender do nome auto-gerado pelo Prisma. Mais robusto contra
    // mudancas de driver e mais legivel.
    const rows = await tx.$queryRaw<Array<{ acquired: boolean }>>`
      SELECT pg_try_advisory_xact_lock(${lockKey}) AS acquired
    `
    const acquired = rows[0]?.acquired === true
    if (!acquired) {
      return { acquired: false as const }
    }
    const result = await fn()
    return { acquired: true as const, result }
  }, { timeout: 10 * 60 * 1000 }) // 10min max — cron jobs longos OK
}
