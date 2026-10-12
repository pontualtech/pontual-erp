/**
 * Resposta PÚBLICA da consulta de situação da OS no site (12/10/2026).
 *
 * /api/public/site/status-os/[number] repassava a resposta inteira de /api/bot/status-os — nome,
 * CPF/CNPJ, telefone e e-mail do cliente, notas internas, quem mexeu na OS — para qualquer pessoa
 * com um número de OS (sequencial; a checagem de Origin se burla com curl). Lista BRANCA com só o
 * que a página do site mostra (função tOS no index.html): campo novo do bot nasce bloqueado.
 */
export function toPublicOsStatus(data: Record<string, any>): Record<string, unknown> {
  if (!data || data.ok !== true) return { ok: false, erro: data?.erro || 'OS nao encontrada' }
  return {
    ok: true,
    os_numero: data.os_numero,
    equipamento: data.equipamento,
    equipamento_tipo: data.equipamento_tipo,
    equipamento_marca: data.equipamento_marca,
    equipamento_modelo: data.equipamento_modelo,
    defeito_relatado: data.defeito_relatado,
    diagnostico: data.diagnostico,
    status: data.status,
    status_cor: data.status_cor,
    status_final: data.status_final,
    prioridade: data.prioridade,
    tecnico: data.tecnico,
    forma_pagamento: data.forma_pagamento,
    previsao_entrega: data.previsao_entrega,
    data_entrega: data.data_entrega,
    garantia: data.garantia,
    garantia_ate: data.garantia_ate,
    criado_em: data.criado_em,
    atualizado_em: data.atualizado_em,
    historico: Array.isArray(data.historico)
      ? data.historico.map((h: any) => ({ data: h.data, de: h.de, para: h.para }))
      : [],
    itens: Array.isArray(data.itens)
      ? data.itens.map((i: any) => ({ descricao: i.descricao, quantidade: i.quantidade, valor_total: i.valor_total }))
      : [],
  }
}
