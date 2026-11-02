import { describe, it, expect } from 'vitest'
import { perguntaDinheiro, perguntaEstorno, resultadoBaixa, resultadoConferencia, resultadoRetornoCnab } from './conferencia'

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

describe('resultadoBaixa (F3-H, m4): Receber/Pagar com aviso não mostram sucesso', () => {
  it('com aviso: atenção com o texto do aviso', () => {
    expect(resultadoBaixa({ aviso: 'dinheiro desta conta já está lançado' }, 'Recebimento registrado!'))
      .toEqual({ aviso: true, mensagem: 'dinheiro desta conta já está lançado' })
  })
  it('sem aviso (ou vazio / sem dados): sucesso com a mensagem da tela', () => {
    expect(resultadoBaixa({ aviso: null }, 'Pagamento registrado!')).toEqual({ aviso: false, mensagem: 'Pagamento registrado!' })
    expect(resultadoBaixa({ aviso: '' }, 'Pagamento registrado!').aviso).toBe(false)
    expect(resultadoBaixa(undefined, 'Pagamento registrado!').aviso).toBe(false)
  })
})

describe('resultadoRetornoCnab (F4-E, m10): retorno com linhas não processadas não vira sucesso', () => {
  it('sem erros: sucesso com pagos/rejeitados e nenhuma linha pendente', () => {
    expect(resultadoRetornoCnab({ pagos: 3, rejeitados: 1 })).toEqual({ aviso: false, mensagem: 'Retorno processado: 3 pagos, 1 rejeitados', naoProcessadas: [] })
    expect(resultadoRetornoCnab({ pagos: 2, rejeitados: 0, erros: [] }).aviso).toBe(false)
  })
  it('com erros: atenção pedindo para reimportar, e a lista "<nosso número> — <motivo>"', () => {
    const r = resultadoRetornoCnab({ pagos: 1, rejeitados: 0, erros: [{ seuNumero: 'r1', nossoNumero: '123', erro: 'conflito com outra operação — repita' }] })
    expect(r).toEqual({
      aviso: true,
      mensagem: 'Retorno processado: 1 pagos, 0 rejeitados — 1 não processado(s): reimporte o arquivo',
      naoProcessadas: ['123 — conflito com outra operação — repita'],
    })
  })
  it('sem nosso número usa o seu número', () => {
    expect(resultadoRetornoCnab({ pagos: 0, rejeitados: 0, erros: [{ seuNumero: 'r9', nossoNumero: '', erro: 'x' }] }).naoProcessadas).toEqual(['r9 — x'])
  })
})

describe('perguntaDinheiro (F7-D): a tela reconhece a pergunta do Receber', () => {
  const lancados = [{ origem: 'boleto (CNAB) cnab:1', valor_centavos: 500, data: '2026-10-20', conta: 'Inter' }]
  it('409 DINHEIRO_JA_LANCADO → mensagem e lançamentos', () => {
    expect(perguntaDinheiro(409, { code: 'DINHEIRO_JA_LANCADO', error: 'Esta conta…', lancados })).toEqual({ mensagem: 'Esta conta…', lancados })
  })
  it('outro 409 / outro status / sem corpo → null', () => {
    expect(perguntaDinheiro(409, { error: 'conflito' })).toBeNull()
    expect(perguntaDinheiro(200, { code: 'DINHEIRO_JA_LANCADO', error: 'x', lancados })).toBeNull()
    expect(perguntaDinheiro(409, null)).toBeNull()
  })
})

describe('perguntaEstorno (F8-A): a tela reconhece a pergunta do estorno', () => {
  const lancados = [{ origem: 'linha do extrato (recebimento anterior AR:r1)', valor_centavos: 15000, data: '2026-11-01', conta: 'Itaú' }]
  it('409 ESTORNO_PERGUNTA → mensagem e lançamentos', () => {
    expect(perguntaEstorno(409, { code: 'ESTORNO_PERGUNTA', error: 'O dinheiro…', lancados })).toEqual({ mensagem: 'O dinheiro…', lancados })
  })
  it('a pergunta do Receber, outro 409, outro status ou sem corpo → null', () => {
    expect(perguntaEstorno(409, { code: 'DINHEIRO_JA_LANCADO', error: 'x', lancados })).toBeNull()
    expect(perguntaEstorno(409, { error: 'conta alterada — repita' })).toBeNull()
    expect(perguntaEstorno(200, { code: 'ESTORNO_PERGUNTA', error: 'x', lancados })).toBeNull()
    expect(perguntaEstorno(409, null)).toBeNull()
  })
})

describe('resultadoConferencia — F7-G (m6, m10): os avisos do Conferir chegam à tela', () => {
  it('avisos viram uma atenção por AR, além do sucesso', () => {
    expect(resultadoConferencia({ updated: 2, ligadas: 0, erros: [], avisos: [
      { ar: 'a1', motivo: 'há linha do banco livre de mesmo valor — vincule pelo Extrato' },
      { ar: 'a2', motivo: 'pagamento Asaas sem lançamento: …' },
    ] }, '2 conferidas')).toEqual({ ok: true, mensagem: '2 conferidas', avisos: [
      'há linha do banco livre de mesmo valor — vincule pelo Extrato', 'pagamento Asaas sem lançamento: …',
    ] })
  })
  it('sem avisos, a forma de antes', () => {
    expect(resultadoConferencia({ updated: 1, ligadas: 0, erros: [], avisos: [] }, 'Conferido')).toEqual({ ok: true, mensagem: 'Conferido' })
  })
})
