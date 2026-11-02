import { describe, it, expect } from 'vitest'
import { resultadoConferencia } from './conferencia'

describe('resultadoConferencia (F14)', () => {
  it('conferida sem vínculo: sucesso com a mensagem da tela', () => {
    expect(resultadoConferencia({ updated: 1, ligadas: 0, erros: [] }, 'Conferido')).toEqual({ ok: true, mensagem: 'Conferido' })
  })
  it('conferida e ligada ao banco: sucesso + "ligada ao banco"', () => {
    expect(resultadoConferencia({ updated: 1, ligadas: 1, erros: [] }, 'Conferido')).toEqual({ ok: true, mensagem: 'Conferido · ligada ao banco' })
    expect(resultadoConferencia({ updated: 3, ligadas: 2, erros: [] }, '3 conferidas')).toEqual({ ok: true, mensagem: '3 conferidas · 2 ligadas ao banco' })
  })
  it('updated 0 com motivo: erro com o motivo', () => {
    expect(resultadoConferencia({ updated: 0, ligadas: 0, erros: [{ ar: 'a1', motivo: 'já conciliada' }] }, 'Conferido'))
      .toEqual({ ok: false, mensagem: 'já conciliada' })
  })
  it('updated 0 sem motivo: erro genérico (nunca sucesso)', () => {
    expect(resultadoConferencia({ updated: 0, ligadas: 0, erros: [] }, 'Conferido')).toEqual({ ok: false, mensagem: 'nenhuma conta foi atualizada' })
    expect(resultadoConferencia(undefined, 'Conferido').ok).toBe(false)
  })
  it('em massa com parte em erro: erro com a contagem e os motivos (sem repetir)', () => {
    const r = resultadoConferencia({
      updated: 2, ligadas: 0,
      erros: [{ ar: 'a1', motivo: 'já conciliada' }, { ar: 'a2', motivo: 'já conciliada' }, { ar: 'a3', motivo: 'conta a receber sem conta bancária; vínculo não feito' }],
    }, '2 conferidas')
    expect(r).toEqual({ ok: false, mensagem: '2 ok, 3 com erro: já conciliada; conta a receber sem conta bancária; vínculo não feito' })
  })
  it('F2-F (#7): resposta do Desfazer com a AR em erros (não conferida / conflito) não vira sucesso', () => {
    const msg = 'Conciliação desfeita — AR volta a "Aguardando"'
    expect(resultadoConferencia({ updated: 0, ligadas: 0, erros: [{ ar: 'a', motivo: 'conta não conferida' }] }, msg)).toEqual({ ok: false, mensagem: 'conta não conferida' })
    expect(resultadoConferencia({ updated: 0, ligadas: 0, erros: [{ ar: 'a', motivo: 'erro ao desfazer; tente de novo' }] }, msg)).toEqual({ ok: false, mensagem: 'erro ao desfazer; tente de novo' })
    expect(resultadoConferencia({ updated: 1, ligadas: 0, erros: [] }, msg)).toEqual({ ok: true, mensagem: msg })
  })
})

