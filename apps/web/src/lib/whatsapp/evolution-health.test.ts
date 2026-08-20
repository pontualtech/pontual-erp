import { describe, it, expect } from 'vitest'
import { isAliveProbe } from './evolution-health'

// Sonda ativa = POST /chat/whatsappNumbers/{inst}. Se o socket WhatsApp esta
// vivo, faz round-trip real e responde [{"exists":true|false,...}]. Zumbi
// (socket morto mas state=open) nao consegue o round-trip -> timeout/erro/vazio.
describe('isAliveProbe — sinal robusto de liveness do Evolution', () => {
  it('VIVO: resposta ok com campo exists (mesmo exists=false = round-trip funcionou)', () => {
    expect(isAliveProbe(true, '[{"jid":"5511966385774@s.whatsapp.net","exists":true,"number":"5511966385774"}]')).toBe(true)
    expect(isAliveProbe(true, '[{"exists":false}]')).toBe(true)
  })
  it('MORTO: corpo vazio, erro, ou sem campo exists', () => {
    expect(isAliveProbe(true, '')).toBe(false)
    expect(isAliveProbe(true, '{"status":404,"error":"Not Found"}')).toBe(false)
    expect(isAliveProbe(true, '{"message":"exists in a random string"}')).toBe(false)
  })
  it('MORTO: status nao-ok mesmo com corpo parecido', () => {
    expect(isAliveProbe(false, '[{"exists":true}]')).toBe(false)
  })
})
