import { describe, it, expect } from 'vitest'
import { buildPixBrCode, crc16ccitt } from './brcode'

// QR PIX nos impressos de entrega (13/09): BR Code ESTATICO (EMV/BCB) com a
// chave da propria empresa (CNPJ) — cliente escaneia e paga na entrega.
// Payload: TLV com 26 (BR.GOV.BCB.PIX + chave), 54 (valor opcional),
// 59/60 (nome<=25/cidade<=15 sem acento), 62.05 (txid) e CRC16-CCITT no 63.
describe('crc16ccitt', () => {
  it('vetor classico CRC-16/CCITT-FALSE("123456789") = 29B1', () => {
    expect(crc16ccitt('123456789')).toBe('29B1')
  })
})

describe('buildPixBrCode', () => {
  const base = { key: '32.772.178/0001-47', merchantName: 'PontualTech Assistência Técnica LTDA', merchantCity: 'São Paulo' }

  it('estrutura EMV valida: inicio, GUI BCB, fim 6304+CRC', () => {
    const p = buildPixBrCode(base)
    expect(p.startsWith('000201')).toBe(true)
    expect(p).toContain('BR.GOV.BCB.PIX')
    expect(p).toMatch(/6304[0-9A-F]{4}$/)
    // CRC confere: recalcular sobre tudo ate 6304 inclusive
    const calc = crc16ccitt(p.slice(0, -4))
    expect(p.endsWith(calc)).toBe(true)
  })

  it('chave CNPJ vai SEM mascara (so digitos) no campo 26.01', () => {
    const p = buildPixBrCode(base)
    expect(p).toContain('32772178000147')
    expect(p).not.toContain('32.772.178')
  })

  it('nome trunca em 25 chars sem acento; cidade 15 uppercase', () => {
    const p = buildPixBrCode(base)
    expect(p).toContain('PONTUALTECH ASSISTENCIA T') // 25 chars
    expect(p).toContain('SAO PAULO')
    expect(p).not.toMatch(/[À-ÿ]/)
  })

  it('com valor: campo 54 com decimal ponto', () => {
    const p = buildPixBrCode({ ...base, amountCents: 123456 })
    expect(p).toContain('54071234.56')
  })

  it('sem valor: campo 54 ausente', () => {
    expect(buildPixBrCode(base)).not.toContain('5407')
  })

  it('txid default *** ; custom sanitizado alfanumerico <=25', () => {
    expect(buildPixBrCode(base)).toContain('62070503***')
    const p = buildPixBrCode({ ...base, txid: 'OS 62458!' })
    expect(p).toContain('OS62458')
  })

  it('TLV: comprimento do campo 26 esta correto', () => {
    const p = buildPixBrCode(base)
    const m = p.match(/26(\d{2})(0014BR\.GOV\.BCB\.PIX0114\d{14})/)
    expect(m).not.toBeNull()
    expect(parseInt(m![1], 10)).toBe(m![2].length)
  })
})
