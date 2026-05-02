import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { requireInternalKey } from './internal-auth'

describe('requireInternalKey (N12 + C9)', () => {
  const originalEnv = process.env.INTERNAL_API_KEY

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.INTERNAL_API_KEY
    else process.env.INTERNAL_API_KEY = originalEnv
  })

  function makeReq(headers: Record<string, string> = {}): NextRequest {
    return new NextRequest('http://localhost/api/internal/test', {
      method: 'POST',
      headers,
    })
  }

  it('retorna 503 quando INTERNAL_API_KEY não configurado', async () => {
    delete process.env.INTERNAL_API_KEY
    const result = requireInternalKey(makeReq({ 'x-internal-key': 'qualquer' }))
    expect(result).not.toBeNull()
    expect(result?.status).toBe(503)
  })

  it('retorna 401 quando key ausente', () => {
    process.env.INTERNAL_API_KEY = 'secret-key-1234567890'
    const result = requireInternalKey(makeReq({}))
    expect(result).not.toBeNull()
    expect(result?.status).toBe(401)
  })

  it('retorna 401 quando key incorreta', () => {
    process.env.INTERNAL_API_KEY = 'secret-key-1234567890'
    const result = requireInternalKey(makeReq({ 'x-internal-key': 'wrong-but-same-len' }))
    expect(result).not.toBeNull()
    expect(result?.status).toBe(401)
  })

  it('retorna 401 quando length diferente (anti-timing)', () => {
    process.env.INTERNAL_API_KEY = 'secret-key-1234567890'
    const result = requireInternalKey(makeReq({ 'x-internal-key': 'short' }))
    expect(result).not.toBeNull()
    expect(result?.status).toBe(401)
  })

  it('retorna null quando key correta (autorizado)', () => {
    process.env.INTERNAL_API_KEY = 'secret-key-1234567890'
    const result = requireInternalKey(makeReq({ 'x-internal-key': 'secret-key-1234567890' }))
    expect(result).toBeNull()
  })
})
