/**
 * Rate limiter em memória (sliding window simplificado)
 * Para produção com múltiplas instâncias, migrar para Redis
 */

const rateMap = new Map<string, { count: number; resetAt: number }>()

// Cleanup expired entries every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    for (const [key, val] of rateMap) {
      if (val.resetAt < now) rateMap.delete(key)
    }
  }, 5 * 60 * 1000)
}

export function rateLimit(
  ip: string,
  maxRequests: number = 100,
  windowMs: number = 60000
): { allowed: boolean; remaining: number } {
  const now = Date.now()
  const entry = rateMap.get(ip)

  if (!entry || entry.resetAt < now) {
    rateMap.set(ip, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: maxRequests - 1 }
  }

  entry.count++
  if (entry.count > maxRequests) {
    return { allowed: false, remaining: 0 }
  }

  return { allowed: true, remaining: maxRequests - entry.count }
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  return forwarded?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
}
