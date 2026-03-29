/**
 * Rate limiter em memória (sliding window simplificado)
 * Para produção com múltiplas instâncias, migrar para Redis
 */

const windows = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { success: boolean; remaining: number } {
  const now = Date.now()
  const record = windows.get(key)

  if (!record || now > record.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowMs })
    return { success: true, remaining: limit - 1 }
  }

  if (record.count >= limit) {
    return { success: false, remaining: 0 }
  }

  record.count++
  return { success: true, remaining: limit - record.count }
}

// Cleanup a cada 60s para evitar memory leak
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    for (const [key, record] of windows) {
      if (now > record.resetAt) windows.delete(key)
    }
  }, 60_000)
}
