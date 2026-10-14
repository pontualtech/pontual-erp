import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

const updateMany = vi.fn().mockResolvedValue({ count: 0 })
vi.mock('@pontual/db', () => ({ prisma: { marketingContact: { updateMany: (...a: unknown[]) => updateMany(...a) } } }))

import { OPTIONS, POST } from './route'

const URL_ = 'https://erp.pontualtech.work/api/public/unsubscribe'

// 2026-10-14: a página pontualtech.com.br/descadastrar.html chama esta rota de outro domínio. Sem os
// cabeçalhos CORS o navegador bloqueava e o cliente via "Erro de conexão" — descadastro nunca funcionou.
describe('unsubscribe — chamada do site (CORS)', () => {
  it('pré-autorização (OPTIONS) do site devolve Access-Control-Allow-Origin', async () => {
    const res = await OPTIONS(new NextRequest(URL_, { method: 'OPTIONS', headers: { origin: 'https://pontualtech.com.br' } }))
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('https://pontualtech.com.br')
    expect(res.headers.get('access-control-allow-headers')).toMatch(/content-type/i)
  })

  it('POST do formulário do site devolve ok e o cabeçalho CORS, e descadastra', async () => {
    updateMany.mockClear()
    const res = await POST(new NextRequest(URL_, {
      method: 'POST',
      headers: { origin: 'https://www.pontualtech.com.br', 'content-type': 'application/json', 'x-real-ip': '10.0.0.1' },
      body: JSON.stringify({ email: 'Cliente.Teste@Example.com' }),
    }))
    expect(res.headers.get('access-control-allow-origin')).toBe('https://www.pontualtech.com.br')
    expect(await res.json()).toEqual({ ok: true })
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { email: 'cliente.teste@example.com', unsubscribed: false } }))
  })

  it('origem desconhecida não é ecoada', async () => {
    const res = await OPTIONS(new NextRequest(URL_, { method: 'OPTIONS', headers: { origin: 'https://site-qualquer.com' } }))
    expect(res.headers.get('access-control-allow-origin')).not.toBe('https://site-qualquer.com')
  })
})
