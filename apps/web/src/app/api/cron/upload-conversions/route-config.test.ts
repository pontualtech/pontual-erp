import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

// 12/10/2026: no Next 14, rota só-GET com `dynamic = 'force-dynamic'` NÃO desliga o Data Cache —
// o token OAuth do Google ficava em cache para sempre e todo upload dava 401 uma hora após cada
// deploy. A rota precisa declarar fetchCache = 'force-no-store'. (Teste de fonte: a suíte não roda o Next.)
describe('upload-conversions: config de cache da rota', () => {
  it("declara fetchCache = 'force-no-store' (sem isso o token do Google fica em cache e vence)", () => {
    const src = readFileSync(path.join(__dirname, 'route.ts'), 'utf8')
    expect(src).toMatch(/^export const fetchCache = 'force-no-store'$/m)
  })
})
