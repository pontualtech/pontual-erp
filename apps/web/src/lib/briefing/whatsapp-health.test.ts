import { describe, it, expect } from 'vitest'
import { avaliarSaudeWhatsapp, detectarPicoDeVolume } from './whatsapp-health'

const saudavel = {
  phones: [{ nome: 'Suporte 2626-3841', status: 'CONNECTED', quality: 'GREEN' }],
  waba: { canSend: 'AVAILABLE', erros: [] as string[] },
  followupLigado: false,
  marketingLigado: false,
}

describe('avaliarSaudeWhatsapp', () => {
  it('tudo verde e travas desligadas → nenhum problema', () => {
    expect(avaliarSaudeWhatsapp(saudavel)).toEqual([])
  })

  it('conta bloqueada pela Meta (caso 09/10) vira alerta com o motivo', () => {
    const p = avaliarSaudeWhatsapp({ ...saudavel, waba: { canSend: 'BLOCKED', erros: ['[141006] erro no pagamento'] } })
    expect(p).toHaveLength(1)
    expect(p[0]).toContain('BLOCKED')
    expect(p[0]).toContain('141006')
  })

  it('qualidade vermelha é problema, amarela é aviso — ambos aparecem', () => {
    const p = avaliarSaudeWhatsapp({
      ...saudavel,
      phones: [
        { nome: 'Suporte', status: 'CONNECTED', quality: 'RED' },
        { nome: 'Vendas', status: 'CONNECTED', quality: 'YELLOW' },
      ],
    })
    expect(p.join(' ')).toMatch(/Suporte.*RED/)
    expect(p.join(' ')).toMatch(/Vendas.*YELLOW/)
  })

  it('número desconectado é problema', () => {
    const p = avaliarSaudeWhatsapp({ ...saudavel, phones: [{ nome: 'Vendas', status: 'DISCONNECTED', quality: 'GREEN' }] })
    expect(p.join(' ')).toMatch(/Vendas.*DISCONNECTED/)
  })

  it('follow-up ou marketing religados são alerta (foi o que causou a restrição)', () => {
    const p = avaliarSaudeWhatsapp({ ...saudavel, followupLigado: true, marketingLigado: true })
    expect(p.join(' ')).toMatch(/follow-up/i)
    expect(p.join(' ')).toMatch(/marketing/i)
  })

  it('falhas de entrega nas últimas 24h denunciam restrição que a API da Meta não mostra (caso 09/10: saúde AVAILABLE e 32 envios "Business Account locked")', () => {
    const p = avaliarSaudeWhatsapp({ ...saudavel, falhasEntrega24h: { total: 32, erro: '131031: Business Account locked' } })
    expect(p).toHaveLength(1)
    expect(p[0]).toContain('32')
    expect(p[0]).toContain('131031')
  })

  it('zero falhas de entrega não gera alerta', () => {
    expect(avaliarSaudeWhatsapp({ ...saudavel, falhasEntrega24h: { total: 0, erro: '' } })).toEqual([])
  })

  it('falha ao consultar a Meta é reportada, não silenciada', () => {
    const p = avaliarSaudeWhatsapp({ ...saudavel, phones: [], waba: null })
    expect(p.join(' ')).toMatch(/n[aã]o consegui consultar/i)
  })
})

describe('detectarPicoDeVolume', () => {
  // volumes reais da PT (Meta analytics, 28/09–08/10): dias úteis 367–688
  const semanaNormal = [688, 685, 541, 367, 510, 112, 43]

  it('dia dentro da faixa histórica não alerta', () => {
    expect(detectarPicoDeVolume([...semanaNormal, 529])).toBeNull()
    expect(detectarPicoDeVolume([...semanaNormal, 700])).toBeNull()
  })

  it('pico claramente acima do histórico alerta com os números', () => {
    const r = detectarPicoDeVolume([...semanaNormal, 1500])
    expect(r).toContain('1500')
    expect(r).toContain('688')
  })

  it('volume baixo (sábado/domingo ou conta restrita) nunca alerta', () => {
    expect(detectarPicoDeVolume([...semanaNormal, 20])).toBeNull()
  })

  it('pouco histórico não gera falso alarme', () => {
    expect(detectarPicoDeVolume([100, 5000])).toBeNull()
  })
})

describe('qualidade de templates', () => {
  it('template com qualidade ruim vira alerta', () => {
    const p = avaliarSaudeWhatsapp({ ...saudavel, templatesRuins: ['pt_cobranca_v3:RED'] })
    expect(p.join(' ')).toMatch(/pt_cobranca_v3:RED/)
  })

  it('pico de volume entra na lista de problemas', () => {
    const p = avaliarSaudeWhatsapp({ ...saudavel, picoVolume: 'Volume ontem 1500 msgs (máx 688)' })
    expect(p.join(' ')).toContain('1500')
  })
})
