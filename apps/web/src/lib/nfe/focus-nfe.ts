/**
 * Focus NFe NF-e Provider
 *
 * Integra com a API Focus NFe para emissao, consulta, cancelamento de NF-e
 * e Manifesto do Destinatario (MDe - NF-e recebidas).
 *
 * Docs: https://focusnfe.com.br/doc/
 *
 * Auth: HTTP Basic (token como username, senha vazia)
 * Ambientes: homologacao (testes) ou producao
 */

import type {
  NfeInput,
  NfeResult,
  NfeRecebida,
  EmitenteConfig,
  FocusNfePayload,
  FocusNfeItemPayload,
  FocusNfeResponse,
} from './types'

// ---------- Internals ----------

function getApiKey(): string {
  const key = process.env.FOCUS_NFE_API_KEY
  if (!key) {
    throw new Error('FOCUS_NFE_API_KEY nao configurada')
  }
  return key
}

function getAuthHeader(apiKey?: string): string {
  const token = apiKey || getApiKey()
  return `Basic ${Buffer.from(`${token}:`).toString('base64')}`
}

function getBaseUrl(environment?: string): string {
  const env = environment || process.env.FOCUS_NFE_ENVIRONMENT || 'homologacao'
  return env === 'producao'
    ? 'https://api.focusnfe.com.br'
    : 'https://homologacao.focusnfe.com.br'
}

function mapFocusStatus(focusStatus?: string): string {
  if (!focusStatus) return 'processando_autorizacao'
  const statusMap: Record<string, string> = {
    autorizado: 'autorizado',
    cancelado: 'cancelado',
    erro_autorizacao: 'erro_autorizacao',
    denegado: 'erro_autorizacao',
    processando_autorizacao: 'processando_autorizacao',
  }
  return statusMap[focusStatus] || 'processando_autorizacao'
}

export function mapToInternalStatus(focusStatus?: string): string {
  if (!focusStatus) return 'PROCESSING'
  const map: Record<string, string> = {
    autorizado: 'AUTHORIZED',
    cancelado: 'CANCELLED',
    erro_autorizacao: 'REJECTED',
    denegado: 'REJECTED',
    processando_autorizacao: 'PROCESSING',
  }
  return map[focusStatus] || 'PROCESSING'
}

// ---------- Emitir NF-e ----------

/**
 * Emitir NF-e via Focus NFe
 *
 * POST /v2/nfe?ref={ref}
 *
 * @param input - Dados da NF-e (natureza operacao, destinatario, items)
 * @param ref - Referencia unica (nfe-{companyId.slice(0,8)}-{timestamp})
 * @param emitente - Dados do emitente
 * @param apiKey - API key Focus NFe (opcional, usa env var)
 * @param environment - Ambiente (opcional, usa env var)
 */
export async function emitirNfe(
  input: NfeInput,
  ref: string,
  emitente: EmitenteConfig,
  apiKey?: string,
  environment?: string,
): Promise<NfeResult> {
  const baseUrl = getBaseUrl(environment)
  const auth = getAuthHeader(apiKey)

  // Build items payload
  const items: FocusNfeItemPayload[] = input.items.map((item, idx) => ({
    numero_item: item.numero_item || idx + 1,
    codigo_produto: item.codigo_produto,
    descricao: item.descricao,
    cfop: item.cfop,
    unidade_comercial: item.unidade_comercial,
    quantidade_comercial: item.quantidade_comercial,
    valor_unitario_comercial: item.valor_unitario_comercial,
    valor_bruto: item.valor_bruto,
    codigo_ncm: item.codigo_ncm,
    // Unidade tributavel = comercial por padrao
    unidade_tributavel: item.unidade_tributavel || item.unidade_comercial,
    quantidade_tributavel: item.quantidade_tributavel ?? item.quantidade_comercial,
    valor_unitario_tributavel: item.valor_unitario_tributavel ?? item.valor_unitario_comercial,
    // Tributacao
    icms_origem: item.icms_origem,
    icms_situacao_tributaria: item.icms_situacao_tributaria,
    pis_situacao_tributaria: item.pis_situacao_tributaria,
    cofins_situacao_tributaria: item.cofins_situacao_tributaria,
    ...(item.peso_liquido != null ? { peso_liquido: item.peso_liquido } : {}),
    ...(item.peso_bruto != null ? { peso_bruto: item.peso_bruto } : {}),
  }))

  // Build main payload
  const payload: FocusNfePayload = {
    natureza_operacao: input.natureza_operacao,
    tipo_documento: 1, // saida
    local_destino: 1, // operacao interna
    finalidade_emissao: input.tipo === 'devolucao' ? 4 : 1,
    consumidor_final: 1,
    presenca_comprador: 1,
    modalidade_frete: input.modalidade_frete ?? 9, // sem frete

    // Emitente
    cnpj_emitente: emitente.cnpj.replace(/\D/g, ''),
    inscricao_estadual_emitente: emitente.inscricao_estadual,
    nome_fantasia_emitente: emitente.nome_fantasia,
    razao_social_emitente: emitente.razao_social,
    logradouro_emitente: emitente.logradouro,
    numero_emitente: emitente.numero,
    complemento_emitente: emitente.complemento,
    bairro_emitente: emitente.bairro,
    codigo_municipio_emitente: emitente.codigo_municipio,
    municipio_emitente: emitente.municipio,
    uf_emitente: emitente.uf,
    cep_emitente: emitente.cep.replace(/\D/g, ''),
    telefone_emitente: emitente.telefone?.replace(/\D/g, ''),
    regime_tributario_emitente: emitente.regime_tributario,

    // Destinatario
    nome_destinatario: input.destinatario.nome,
    logradouro_destinatario: input.destinatario.endereco.logradouro,
    numero_destinatario: input.destinatario.endereco.numero,
    complemento_destinatario: input.destinatario.endereco.complemento,
    bairro_destinatario: input.destinatario.endereco.bairro,
    codigo_municipio_destinatario: input.destinatario.endereco.codigo_municipio,
    municipio_destinatario: input.destinatario.endereco.municipio,
    uf_destinatario: input.destinatario.endereco.uf,
    cep_destinatario: input.destinatario.endereco.cep.replace(/\D/g, ''),

    items,
  }

  // CNPJ ou CPF do destinatario
  if (input.destinatario.cnpj) {
    payload.cnpj_destinatario = input.destinatario.cnpj.replace(/\D/g, '')
  } else if (input.destinatario.cpf) {
    payload.cpf_destinatario = input.destinatario.cpf.replace(/\D/g, '')
  }

  // Inscricao estadual
  if (input.destinatario.inscricao_estadual) {
    payload.inscricao_estadual_destinatario = input.destinatario.inscricao_estadual
    payload.indicador_inscricao_estadual_destinatario = 1
  } else {
    payload.indicador_inscricao_estadual_destinatario = 9 // nao contribuinte
  }

  // Email
  if (input.destinatario.email) {
    payload.email_destinatario = input.destinatario.email
  }

  // Notas referenciadas
  if (input.notas_referenciadas && input.notas_referenciadas.length > 0) {
    payload.notas_referenciadas = input.notas_referenciadas.map(chave => ({
      chave_nfe: chave,
    }))
  }

  // Informacoes adicionais
  if (input.informacoes_adicionais) {
    payload.informacoes_adicionais_contribuinte = input.informacoes_adicionais
  }

  const url = `${baseUrl}/v2/nfe?ref=${encodeURIComponent(ref)}`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const data: FocusNfeResponse = await response.json()

  if (!response.ok) {
    const errorMsg = data.erros
      ? data.erros.map(e => e.mensagem).join('; ')
      : data.mensagem || `Erro HTTP ${response.status}`

    return {
      status: 'erro_autorizacao',
      mensagem_sefaz: errorMsg,
      ref,
      raw_response: data as unknown as Record<string, unknown>,
    }
  }

  return {
    status: mapFocusStatus(data.status),
    chave_nfe: data.chave_nfe,
    numero: data.numero,
    serie: data.serie,
    url_danfe: data.caminho_danfe,
    url_xml: data.caminho_xml_nota_fiscal,
    mensagem_sefaz: data.mensagem_sefaz,
    protocolo: data.protocolo,
    ref: data.ref || ref,
    raw_response: data as unknown as Record<string, unknown>,
  }
}

// ---------- Consultar NF-e ----------

/**
 * Consultar NF-e via Focus NFe
 *
 * GET /v2/nfe/{ref}
 */
export async function consultarNfe(
  ref: string,
  apiKey?: string,
  environment?: string,
): Promise<NfeResult> {
  const baseUrl = getBaseUrl(environment)
  const auth = getAuthHeader(apiKey)

  const url = `${baseUrl}/v2/nfe/${encodeURIComponent(ref)}`

  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: auth },
  })

  if (!response.ok) {
    if (response.status === 404) {
      return {
        status: 'erro_autorizacao',
        mensagem_sefaz: 'NF-e nao encontrada no provedor',
        ref,
      }
    }
    return {
      status: 'erro_autorizacao',
      mensagem_sefaz: `Erro ao consultar: HTTP ${response.status}`,
      ref,
    }
  }

  const data: FocusNfeResponse = await response.json()

  return {
    status: mapFocusStatus(data.status),
    chave_nfe: data.chave_nfe,
    numero: data.numero,
    serie: data.serie,
    url_danfe: data.caminho_danfe,
    url_xml: data.caminho_xml_nota_fiscal,
    mensagem_sefaz: data.mensagem_sefaz,
    protocolo: data.protocolo,
    ref: data.ref || ref,
    raw_response: data as unknown as Record<string, unknown>,
  }
}

// ---------- Cancelar NF-e ----------

/**
 * Cancelar NF-e via Focus NFe
 *
 * DELETE /v2/nfe/{ref}
 * Body: { justificativa: string }
 */
export async function cancelarNfe(
  ref: string,
  justificativa: string,
  apiKey?: string,
  environment?: string,
): Promise<void> {
  const baseUrl = getBaseUrl(environment)
  const auth = getAuthHeader(apiKey)

  if (!justificativa || justificativa.trim().length < 15) {
    throw new Error('Justificativa deve ter no minimo 15 caracteres')
  }

  const url = `${baseUrl}/v2/nfe/${encodeURIComponent(ref)}`

  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ justificativa }),
  })

  if (!response.ok) {
    let errorMsg = `Erro ao cancelar: HTTP ${response.status}`
    try {
      const data = await response.json()
      if (data.mensagem) errorMsg = data.mensagem
      if (data.erros) errorMsg = data.erros.map((e: any) => e.mensagem).join('; ')
    } catch {
      // ignore parse error
    }
    throw new Error(errorMsg)
  }
}

// ---------- Listar NF-e Recebidas (MDe) ----------

/**
 * Listar NF-e recebidas via Focus NFe (MDe)
 *
 * GET /v2/nfes_recebidas?cnpj={cnpj}
 */
export async function listarRecebidas(
  cnpj: string,
  apiKey?: string,
  environment?: string,
  versao?: number,
): Promise<NfeRecebida[]> {
  const baseUrl = getBaseUrl(environment)
  const auth = getAuthHeader(apiKey)

  const params = new URLSearchParams()
  params.set('cnpj', cnpj.replace(/\D/g, ''))
  if (versao != null) params.set('versao', String(versao))

  const url = `${baseUrl}/v2/nfes_recebidas?${params}`

  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: auth },
  })

  if (!response.ok) {
    throw new Error(`Erro ao listar NF-e recebidas: HTTP ${response.status}`)
  }

  const data = await response.json()

  // A API retorna array de objetos
  if (!Array.isArray(data)) return []

  return data.map((nfe: any) => ({
    chave: nfe.chave,
    nome_emitente: nfe.nome_emitente || nfe.razao_social_emitente || '',
    cnpj_emitente: nfe.cnpj_emitente || '',
    valor_total: nfe.valor_total || 0,
    data_emissao: nfe.data_emissao || '',
    situacao: nfe.situacao || 'pendente',
    manifestacao: nfe.manifestacao,
    tipo_nfe: nfe.tipo_nfe,
    numero: nfe.numero,
    serie: nfe.serie,
  }))
}

// ---------- Manifestar NF-e Recebida ----------

/**
 * Registrar manifestacao sobre NF-e recebida
 *
 * POST /v2/nfes_recebidas/{chave}/manifesto
 * Body: { tipo: "ciencia"|"confirmacao"|"desconhecimento"|"nao_realizada", justificativa?: string }
 */
export async function manifestar(
  chave: string,
  tipo: 'ciencia' | 'confirmacao' | 'desconhecimento' | 'nao_realizada',
  apiKey?: string,
  environment?: string,
  justificativa?: string,
): Promise<void> {
  const baseUrl = getBaseUrl(environment)
  const auth = getAuthHeader(apiKey)

  // Justificativa obrigatoria para desconhecimento e nao_realizada
  if ((tipo === 'desconhecimento' || tipo === 'nao_realizada') && (!justificativa || justificativa.trim().length < 15)) {
    throw new Error('Justificativa obrigatoria (minimo 15 caracteres) para desconhecimento ou nao realizada')
  }

  const body: any = { tipo }
  if (justificativa) body.justificativa = justificativa

  const url = `${baseUrl}/v2/nfes_recebidas/${encodeURIComponent(chave)}/manifesto`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    let errorMsg = `Erro ao manifestar: HTTP ${response.status}`
    try {
      const data = await response.json()
      if (data.mensagem) errorMsg = data.mensagem
      if (data.erros) errorMsg = data.erros.map((e: any) => e.mensagem).join('; ')
    } catch {
      // ignore parse error
    }
    throw new Error(errorMsg)
  }
}

// ---------- Obter NF-e Recebida Completa ----------

/**
 * Obter dados completos de uma NF-e recebida
 *
 * GET /v2/nfes_recebidas/{chave}.json
 */
export async function obterRecebidaCompleta(
  chave: string,
  apiKey?: string,
  environment?: string,
): Promise<any> {
  const baseUrl = getBaseUrl(environment)
  const auth = getAuthHeader(apiKey)

  const url = `${baseUrl}/v2/nfes_recebidas/${encodeURIComponent(chave)}.json`

  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: auth },
  })

  if (!response.ok) {
    throw new Error(`Erro ao obter NF-e recebida: HTTP ${response.status}`)
  }

  return response.json()
}
