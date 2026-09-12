import { describe, it, expect } from 'vitest'
import { probeStatus, buildBriefingHtml, type BriefingData } from './daily'

// Relatorio Diario do Comandante (12/09): email unico 08h com bots, operacao,
// financeiro e infra das ultimas 24h. Regra da casa (feedback_varredura_timestamp):
// termina com resumo LUDICO + hora de execucao.
const BASE: BriefingData = {
  geradoEm: '13/09/2026, 08:00',
  empresas: [
    {
      nome: 'PontualTech',
      bots: { conversas: 42, turnos: 180, erros: 2, transferidos: 5 },
      watchdog: { redispatches: 1, alertas: 0 },
      os: { criadas24h: 7, prontasAguardando: 12 },
      financeiro: { concHigh: 2, concWatch: 4 },
    },
    {
      nome: 'Imprimitech',
      bots: { conversas: 11, turnos: 40, erros: 0, transferidos: 1 },
      watchdog: { redispatches: 0, alertas: 0 },
      os: { criadas24h: 2, prontasAguardando: 3 },
      financeiro: { concHigh: 3, concWatch: 5 },
    },
  ],
  infra: [
    { nome: 'ERP', ok: true },
    { nome: 'Dify PT', ok: true },
    { nome: 'Dify IMP', ok: true },
    { nome: 'Chatwoot PT', ok: true },
    { nome: 'Chatwoot IMP', ok: true },
  ],
}

describe('probeStatus', () => {
  it('todos ok -> verde', () => {
    expect(probeStatus(BASE.infra)).toBe('🟢')
  })
  it('1 fora -> vermelho', () => {
    expect(probeStatus([{ nome: 'ERP', ok: true }, { nome: 'Dify IMP', ok: false }])).toBe('🔴')
  })
})

describe('buildBriefingHtml', () => {
  it('contem as 4 secoes por empresa + infra + hora + fecho ludico', () => {
    const html = buildBriefingHtml(BASE)
    for (const s of ['PontualTech', 'Imprimitech', 'Bots', 'Opera', 'Financeiro', 'Infra', '13/09/2026, 08:00']) {
      expect(html).toContain(s)
    }
    // fecho ludico existe (emoji de navio do comandante)
    expect(html).toMatch(/⛵|🚢|🫡/)
  })
  it('numeros aparecem no html', () => {
    const html = buildBriefingHtml(BASE)
    expect(html).toContain('42')  // conversas PT
    expect(html).toContain('12')  // prontas PT
  })
  it('servico fora do ar e destacado com vermelho', () => {
    const html = buildBriefingHtml({ ...BASE, infra: [{ nome: 'Dify IMP', ok: false }] })
    expect(html).toContain('🔴')
    expect(html).toContain('Dify IMP')
  })
  it('alerta de watchdog pendente vira aviso urgente', () => {
    const d: BriefingData = { ...BASE, empresas: [{ ...BASE.empresas[0], watchdog: { redispatches: 3, alertas: 2 } }] }
    const html = buildBriefingHtml(d)
    expect(html).toMatch(/🚨/)
    expect(html).toContain('2')
  })
  it('dia tranquilo NAO tem 🚨', () => {
    expect(buildBriefingHtml(BASE)).not.toMatch(/🚨/)
  })
})
