/**
 * Singleton Redis connection pra BullMQ.
 *
 * Lazy init: so conecta quando alguma fun export e chamada. Sem REDIS_URL
 * (dev local sem Redis), getRedis() throw — caller decide como tratar.
 *
 * Por que IORedis e nao node-redis? BullMQ exige IORedis (peer dep).
 */
import IORedis, { type Redis } from 'ioredis'

let _redis: Redis | null = null

export function getRedis(): Redis {
  if (_redis) return _redis
  const url = process.env.REDIS_URL
  if (!url) {
    throw new Error('REDIS_URL nao configurado — fila de email indisponivel')
  }
  _redis = new IORedis(url, {
    maxRetriesPerRequest: null,  // BullMQ exige null (gerencia retry sozinho)
    enableReadyCheck: false,
    lazyConnect: true,
  })
  _redis.on('error', (err) => {
    console.error('[email-queue/redis] connection error:', err.message)
  })
  return _redis
}

export function isQueueAvailable(): boolean {
  return !!process.env.REDIS_URL
}

// Pra testes/cleanup
export async function closeRedis(): Promise<void> {
  if (_redis) {
    await _redis.quit()
    _redis = null
  }
}
