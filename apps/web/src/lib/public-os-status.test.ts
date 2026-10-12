import { describe, it, expect } from 'vitest'
import { toPublicOsStatus } from './public-os-status'

// OS fictícia no formato que /api/bot/status-os devolve.
const osDoBot = {
  ok: true,
  os_numero: 99001,
  os_id: 'uuid-interno',
  cliente: { nome: 'FULANO DE TAL', documento: '00000000000', telefone: '11900000000', email: 'fulano@exemplo.com' },
  equipamento: 'IMPRESSORA EPSON L3250',
  equipamento_tipo: 'IMPRESSORA', equipamento_marca: 'EPSON', equipamento_modelo: 'L3250',
  numero_serie: 'SERIE-TESTE',
  defeito_relatado: 'não puxa papel',
  diagnostico: 'rolete gasto',
  observacoes: 'cliente pediu sigilo',
  notas_internas: 'nota interna da equipe',
  status: 'Aprovado', status_cor: '#0a0', status_final: false,
  prioridade: 'MEDIUM', tecnico: 'Técnico X', tipo: 'AVULSO', local: 'EXTERNO',
  custo_estimado: 30000, custo_total: 35000, total_pecas: 20000, total_servicos: 15000,
  forma_pagamento: 'PIX', previsao_entrega: '2026-10-20', data_entrega: null,
  garantia: false, garantia_ate: null, criado_em: '2026-10-01', atualizado_em: '2026-10-02',
  historico: [{ data: '2026-10-02', de: 'Orcar', para: 'Aprovado', por: 'uuid-funcionario', notas: 'cliente xingou' }],
  itens: [{ descricao: 'Rolete', tipo: 'PECA', quantidade: 1, valor_unitario: 20000, valor_total: 20000 }],
}

describe('toPublicOsStatus (consulta pública de situação da OS no site)', () => {
  const pub = toPublicOsStatus(osDoBot) as Record<string, any>

  it('nunca devolve dado pessoal do cliente nem notas internas', () => {
    const json = JSON.stringify(pub)
    for (const segredo of ['FULANO', '00000000000', '11900000000', 'fulano@exemplo.com', 'sigilo', 'nota interna', 'xingou', 'uuid-funcionario', 'uuid-interno', 'SERIE-TESTE']) {
      expect(json).not.toContain(segredo)
    }
    expect(pub.cliente).toBeUndefined()
  })

  it('mantém tudo que a página do site mostra', () => {
    expect(pub).toMatchObject({
      ok: true, os_numero: 99001, equipamento: 'IMPRESSORA EPSON L3250', defeito_relatado: 'não puxa papel',
      diagnostico: 'rolete gasto', status: 'Aprovado', prioridade: 'MEDIUM', tecnico: 'Técnico X',
      forma_pagamento: 'PIX', previsao_entrega: '2026-10-20', criado_em: '2026-10-01',
    })
    expect(pub.historico).toEqual([{ data: '2026-10-02', de: 'Orcar', para: 'Aprovado' }])
    expect(pub.itens).toEqual([{ descricao: 'Rolete', quantidade: 1, valor_total: 20000 }])
  })

  it('campo novo que o robô passar a devolver nasce bloqueado (lista branca)', () => {
    expect((toPublicOsStatus({ ...osDoBot, campo_novo_secreto: 'x' }) as any).campo_novo_secreto).toBeUndefined()
  })

  it('resposta de erro do robô passa adiante sem dados', () => {
    expect(toPublicOsStatus({ ok: false, erro: 'OS nao encontrada' })).toEqual({ ok: false, erro: 'OS nao encontrada' })
  })
})
