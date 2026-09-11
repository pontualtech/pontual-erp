import { describe, it, expect } from 'vitest'
import { classifyVacuum, HOLDING_MARKERS } from './vacuum'

// Watchdog de vacuo (auditoria bots 11/09): clientes ficavam SEM resposta quando
// o callDify estourava timeout (catch antigo: nota privada + silencio) ou quando
// o pipeline morria por causa nova. O watchdog varre o Chatwoot e re-dispara o
// pipeline; este helper decide o destino de cada conversa. Regras:
// - so a ULTIMA mensagem publica importa; notas privadas sao invisiveis
// - holding do bot ("travadinha"/"instabilidade") NAO conta como resposta
// - vacuo = incoming ha 5-120min sem resposta substantiva
// - despedidas curtas ("ok", "obrigado", emoji) nao disparam re-processo
type M = { type: 'incoming' | 'outgoing'; private?: boolean; content: string; created_at: number }
const NOW = 1_800_000_000 // segundos
const min = (n: number) => NOW - n * 60

const inc = (content: string, at: number): M => ({ type: 'incoming', content, created_at: at })
const out = (content: string, at: number): M => ({ type: 'outgoing', content, created_at: at })
const nota = (content: string, at: number): M => ({ type: 'outgoing', private: true, content, created_at: at })

describe('classifyVacuum', () => {
  it('vacuum: incoming ha 10min sem resposta', () => {
    expect(classifyVacuum([inc('minha impressora nao liga', min(10))], NOW)).toBe('vacuum')
  })
  it('answered: bot respondeu depois do incoming', () => {
    expect(classifyVacuum([inc('oi', min(10)), out('Oi! Sou a Ana 😊', min(9))], NOW)).toBe('answered')
  })
  it('too_fresh: <5min (pipeline ainda pode estar processando/debounce)', () => {
    expect(classifyVacuum([inc('oi', min(3))], NOW)).toBe('too_fresh')
  })
  it('too_old: >120min (nao reabrir conversa fria do nada)', () => {
    expect(classifyVacuum([inc('oi', min(200))], NOW)).toBe('too_old')
  })
  it('nota privada NAO conta como resposta (o caso do timeout real)', () => {
    expect(classifyVacuum([
      inc('Ola! Preciso de ajuda com minha impressora.', min(30)),
      nota('[BOT] ⚠️ Erro ao chamar Dify AI. Atendente precisa assumir.', min(29)),
    ], NOW)).toBe('vacuum')
  })
  it('holding NAO conta como resposta (watchdog enxerga atraves)', () => {
    for (const marker of HOLDING_MARKERS) {
      expect(classifyVacuum([
        inc('quero orcamento', min(20)),
        out(marker + ' resto da frase', min(19)),
      ], NOW)).toBe('vacuum')
    }
  })
  it('farewell: despedidas curtas nao disparam re-processo', () => {
    for (const f of ['ok', 'Ok obrigada', 'valeu!', 'Obrigado.', 'até', '🙏🙏', '👍']) {
      expect(classifyVacuum([out('resposta', min(11)), inc(f, min(10))], NOW)).toBe('farewell')
    }
  })
  it('mensagem substantiva que COMECA com obrigado ainda e vacuum', () => {
    expect(classifyVacuum([inc('obrigado, mas e a coleta? pode ser amanha de manha?', min(10))], NOW)).toBe('vacuum')
  })
  it('no_incoming: ultima publica e outgoing normal', () => {
    expect(classifyVacuum([inc('oi', min(20)), out('resposta completa', min(19))], NOW)).toBe('answered')
    expect(classifyVacuum([out('follow-up do bot', min(10))], NOW)).toBe('no_incoming')
    expect(classifyVacuum([], NOW)).toBe('no_incoming')
  })
  it('incoming sem texto mas presumivel midia ainda e vacuum (bot deve reagir)', () => {
    expect(classifyVacuum([inc('', min(10))], NOW)).toBe('farewell')
  })
})
