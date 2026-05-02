import { describe, it, expect, vi } from 'vitest'

// Mock prisma antes de importar tenant.ts pra evitar conexão DB real
vi.mock('./index', () => {
  const mockTx = {
    $executeRaw: vi.fn(async () => 0),
    $executeRawUnsafe: vi.fn(async () => 0),
  }
  return {
    prisma: {
      $transaction: vi.fn(async (fn: any) => fn(mockTx)),
      $executeRaw: vi.fn(async () => 0),
      $executeRawUnsafe: vi.fn(async () => 0),
    },
  }
})

// Importa depois do mock
import { withTenantTx, setTenantContextOnConnection } from './tenant'

describe('withTenantTx (N15 + M-007 wrapper)', () => {
  it('rejeita companyId vazio', async () => {
    await expect(withTenantTx('', async () => 1)).rejects.toThrow('companyId inválido')
  })

  it('rejeita companyId com SQL injection chars', async () => {
    await expect(withTenantTx("'; DROP TABLE--", async () => 1)).rejects.toThrow('companyId inválido')
    await expect(withTenantTx('foo bar', async () => 1)).rejects.toThrow('companyId inválido')
    await expect(withTenantTx('foo;bar', async () => 1)).rejects.toThrow('companyId inválido')
  })

  it('aceita companyId UUID-like', async () => {
    await expect(withTenantTx('abc-123_def', async () => 'OK')).resolves.toBe('OK')
  })

  it('aceita companyId com underscores e hífens', async () => {
    await expect(withTenantTx('pontualtech-001', async () => 'OK')).resolves.toBe('OK')
  })
})

describe('setTenantContextOnConnection (N32 deprecated)', () => {
  it('emite warning sobre deprecation', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await setTenantContextOnConnection('pontualtech-001')
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('DEPRECATED'))
    warnSpy.mockRestore()
  })

  it('rejeita companyId inválido', async () => {
    await expect(setTenantContextOnConnection('')).rejects.toThrow('companyId inválido')
  })
})
