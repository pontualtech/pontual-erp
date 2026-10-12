import { describe, it, expect, vi, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { forwardToBot } from './public-proxy'

// 12/10/2026: as rotas públicas do site (status-os, consultar, equipamentos) são force-dynamic; no
// Next 14 isso NÃO desliga o Data Cache — sem cache: 'no-store', a resposta de cada OS ficava
// guardada até o próximo deploy e o cliente via no site uma situação velha da OS.
describe('forwardToBot', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  it("repassa ao ERP com cache: 'no-store' (status da OS nunca pode vir de cache)", async () => {
    vi.stubEnv('BOT_ANA_API_KEY', 'chave-de-teste')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://erp.local')
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await forwardToBot(new NextRequest('https://site.local/api/public/site/status-os/12345?x=1'), '/api/bot/os/consultar')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://erp.local/api/bot/os/consultar?x=1')
    expect(init.cache).toBe('no-store')
  })
})
