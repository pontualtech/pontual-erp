import { describe, it, expect } from 'vitest'
import { decideClickMatch, pickCustomerConsumption, type ClickMatchInput } from './click-match'

const T = new Date('2026-10-06T14:00:00Z').getTime()
const at = (ms: number) => new Date(T + ms)
const S = 1000
const MIN = 60 * S
const CLIENTE = 123

// Caso típico de clique comprovadamente do cliente: clicou, mandou mensagem em 1 min numa
// conversa nova da Ana, único clique livre na janela, OS aberta depois.
const base = (over: Partial<ClickMatchInput> = {}): ClickMatchInput => ({
  clicks: [{ clickAt: at(0), consumedAt: at(1 * MIN), consumedByConvId: CLIENTE }],
  customerConvIds: new Set([CLIENTE]),
  otherCustomerOsWithGclid: 0,
  otherNewConsumers: 0,
  tokenConvs: [],
  consumption: { clickAt: at(0), consumedAt: at(1 * MIN), conversation: { inboxId: 11, createdAt: at(55 * S) } },
  freeClicksInWindow: 0,
  osCreatedAt: at(10 * MIN),
  salesInboxes: new Set([2, 4, 9, 11, 7]),
  ...over,
})
const conv = (inboxId: number | null, createdAt: Date) => ({ clickAt: at(0), consumedAt: at(1 * MIN), conversation: { inboxId, createdAt } })

describe('decideClickMatch', () => {
  it('clique exato-causal passa', () => {
    expect(decideClickMatch(base())).toEqual({ ok: true, reason: 'exato' })
  })

  it('OS sem conversa do cliente (sem telefone/conversa) → barra', () => {
    expect(decideClickMatch(base({ customerConvIds: new Set(), consumption: null })).reason).toBe('sem_conversa_do_cliente')
  })

  describe('disputa entre clientes', () => {
    it('mesmo gclid na OS de outro cliente → barra (não dá para saber de quem é)', () => {
      expect(decideClickMatch(base({ otherCustomerOsWithGclid: 1 })).reason).toBe('gclid_em_outra_os')
    })

    it('mesmo gclid consumido pela conversa nova de outro cliente → barra', () => {
      expect(decideClickMatch(base({ otherNewConsumers: 1 })).reason).toBe('clique_compartilhado')
    })
  })

  describe('etiqueta [ref:]', () => {
    it('do próprio cliente, antes da OS → passa (é o próprio clique na mensagem)', () => {
      const r = decideClickMatch(base({ tokenConvs: [{ chatwootConvId: CLIENTE, capturedAt: at(30 * S) }], consumption: null }))
      expect(r).toEqual({ ok: true, reason: 'etiqueta' })
    })

    it('de outro cliente (o fingerprint deu o clique dele a esta conversa) → barra', () => {
      const r = decideClickMatch(base({ tokenConvs: [{ chatwootConvId: 999, capturedAt: at(30 * S) }] }))
      expect(r.reason).toBe('clique_de_outro_cliente')
    })

    it('OS antiga que herdou a etiqueta de um clique posterior → barra', () => {
      const r = decideClickMatch(base({ tokenConvs: [{ chatwootConvId: CLIENTE, capturedAt: at(30 * S) }], osCreatedAt: at(-3 * 24 * 60 * MIN) }))
      expect(r.reason).toBe('os_antes_do_clique')
    })

    it('etiqueta do próprio cliente vence disputa (o fingerprint deu o clique dele a outra conversa)', () => {
      const r = decideClickMatch(base({ tokenConvs: [{ chatwootConvId: CLIENTE, capturedAt: at(30 * S) }], otherNewConsumers: 1, consumption: null }))
      expect(r).toEqual({ ok: true, reason: 'etiqueta' })
    })

    it('horário pelo 1º clique, não pelo captured_at que o bot regrava depois da OS', () => {
      // cliente voltou ao site depois de abrir a OS: captured_at ficou posterior à OS, mas o clique é anterior
      const r = decideClickMatch(base({ tokenConvs: [{ chatwootConvId: CLIENTE, capturedAt: at(2 * 24 * 60 * MIN) }], consumption: null }))
      expect(r).toEqual({ ok: true, reason: 'etiqueta' })
    })
  })

  it('gclid sem clique registrado e sem etiqueta não é comprovável → barra', () => {
    expect(decideClickMatch(base({ clicks: [], consumption: null })).reason).toBe('clique_desconhecido')
  })

  it('clique consumido só pela conversa de outra pessoa → barra', () => {
    const clicks = [{ clickAt: at(0), consumedAt: at(1 * MIN), consumedByConvId: 999 }]
    expect(decideClickMatch(base({ clicks, consumption: null })).reason).toBe('clique_de_outro_cliente')
  })

  it('clique que ninguém consumiu → barra', () => {
    const clicks = [{ clickAt: at(0), consumedAt: null, consumedByConvId: null }]
    expect(decideClickMatch(base({ clicks, consumption: null })).reason).toBe('clique_nao_consumido')
  })

  it('conversa que já existia antes do clique (cliente antigo pegou o clique de outro) → barra', () => {
    expect(decideClickMatch(base({ consumption: conv(11, at(-2 * 60 * MIN)) })).reason).toBe('conversa_antiga')
  })

  it('folga de relógio é só 5 s: conversa 3 s antes passa, 30 s antes não', () => {
    expect(decideClickMatch(base({ consumption: conv(11, at(-3 * S)) })).ok).toBe(true)
    expect(decideClickMatch(base({ consumption: conv(11, at(-30 * S)) })).reason).toBe('conversa_antiga')
  })

  it('1ª mensagem mais de 3 min depois do clique → barra; até 3 min passa', () => {
    const late = { clickAt: at(0), consumedAt: at(3 * MIN + S), conversation: { inboxId: 11, createdAt: at(3 * MIN) } }
    expect(decideClickMatch(base({ consumption: late })).reason).toBe('mensagem_tardia')
    const ok = { clickAt: at(0), consumedAt: at(3 * MIN), conversation: { inboxId: 11, createdAt: at(3 * MIN) } }
    expect(decideClickMatch(base({ consumption: ok })).ok).toBe(true)
  })

  it('havia outro clique livre na janela (o fingerprint pode ter pego o errado) → barra', () => {
    expect(decideClickMatch(base({ freeClicksInWindow: 1 })).reason).toBe('varios_cliques')
  })

  it('OS aberta antes do clique → barra', () => {
    expect(decideClickMatch(base({ osCreatedAt: at(-5 * MIN) })).reason).toBe('os_antes_do_clique')
    expect(decideClickMatch(base({ osCreatedAt: null })).reason).toBe('os_antes_do_clique')
  })

  it('conversa do Suporte (nenhum botão do site leva lá) → barra', () => {
    expect(decideClickMatch(base({ consumption: conv(10, at(55 * S)) })).reason).toBe('caixa_nao_venda')
  })

  it('caixa não gravada no ERP → "caixa_desconhecida" (quem chama resolve no Chatwoot)', () => {
    expect(decideClickMatch(base({ consumption: conv(null, at(55 * S)) }))).toEqual({ ok: false, reason: 'caixa_desconhecida' })
  })
})

describe('pickCustomerConsumption', () => {
  it('pega o 1º consumo feito por conversa do cliente, ignorando consumos de outras pessoas', () => {
    const clicks = [
      { clickAt: at(0), consumedAt: at(30 * S), consumedByConvId: 999 },          // outra pessoa, antes
      { clickAt: at(10 * S), consumedAt: at(5 * MIN), consumedByConvId: CLIENTE }, // cliente, depois
      { clickAt: at(20 * S), consumedAt: at(2 * MIN), consumedByConvId: CLIENTE }, // cliente, 1º
    ]
    expect(pickCustomerConsumption(clicks, new Set([CLIENTE]))?.consumedAt).toEqual(at(2 * MIN))
  })

  it('sem consumo do cliente → null', () => {
    const clicks = [{ clickAt: at(0), consumedAt: at(30 * S), consumedByConvId: 999 }]
    expect(pickCustomerConsumption(clicks, new Set([CLIENTE]))).toBeNull()
  })
})
