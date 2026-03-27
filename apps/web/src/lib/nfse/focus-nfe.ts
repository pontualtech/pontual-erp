/**
 * Focus NFe NFS-e Provider
 *
 * Integra com a API Focus NFe para emissao, consulta e cancelamento de NFS-e.
 * Docs: https://focusnfe.com.br/doc/
 *
 * Auth: HTTP Basic (token como username, senha vazia)
 * Ambientes: homologacao (testes) ou producao
 */

import type {
  NfseInput,
  NfseResult,
  PrestadorConfig,
  FocusNfsePayload,
  FocalNfseResponse,
} from './types'

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

function getBaseUrlFromConfig(environment?: string): string {
  const env = environment || process.env.FOCUS_NFE_ENVIRONMENT || 'homologacao'
  return env === 'producao'
    ? 'https://api.focusnfe.com.br'
    : 'https://homologacao.focusnfe.com.br'
}

function mapFocusStatus(focusStatus?: string): NfseResult['status'] {
  if (!focusStatus) return 'processando'
  const statusMap: Record<string, NfseResult['status']> = {
    autorizado: 'autorizada',
    cancelado: 'cancelada',
    erro_autorizacao: 'erro',
    denegado: 'erro',
    processando_autorizacao: 'processando',
  }
  return statusMap[focusStatus] || 'processando'
}

function mapToInternalStatus(focusStatus?: string): string {
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

/**
 * Emitir NFS-e via Focus NFe
 *
 * POST /v2/nfse?ref={ref}
 *
 * @param input - Dados do tomador e servico
 * @param ref - Referencia unica (nfse-{companyId.slice(0,8)}-{timestamp})
 * @param prestador - Dados do prestador (CNPJ, inscricao municipal, codigo municipio)
 * @param apiKey - API key do Focus NFe (opcional, usa env var se nao fornecido)
 * @param environment - Ambiente (opcional, usa env var se nao fornecido)
 */
export async function emitirNfse(
  input: NfseInput,
  ref: string,
  prestador: PrestadorConfig,
  apiKey?: string,
  environment?: string,
): Promise<NfseResult> {
  const baseUrl = getBaseUrlFromConfig(environment)
  const auth = getAuthHeader(apiKey)

  // Monta o payload no formato Focus NFe
  const payload: FocusNfsePayload = {
    prestador: {
      cnpj: prestador.cnpj,
      inscricao_municipal: prestador.inscricao_municipal,
      codigo_municipio: prestador.codigo_municipio,
    },
    tomador: {
      cpf_cnpj: input.cnpj_tomador || input.cpf_tomador || '',
      razao_social: input.razao_social_tomador,
      endereco: {
        logradouro: input.endereco_tomador.logradouro,
        numero: input.endereco_tomador.numero,
        bairro: input.endereco_tomador.bairro,
        codigo_municipio: input.endereco_tomador.codigo_municipio,
        uf: input.endereco_tomador.uf,
        cep: input.endereco_tomador.cep,
      },
    },
    servico: {
      aliquota: input.servico.aliquota,
      discriminacao: input.servico.discriminacao,
      iss_retido: input.servico.iss_retido,
      item_lista_servico: input.servico.item_lista_servico,
      valor_servicos: input.servico.valor_servicos, // ja em REAIS
      codigo_municipio: input.servico.codigo_municipio,
    },
  }

  if (input.data_emissao) {
    payload.data_emissao = input.data_emissao
  }

  const url = `${baseUrl}/v2/nfse?ref=${encodeURIComponent(ref)}`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const data: FocalNfseResponse = await response.json()

  if (!response.ok) {
    const errorMsg = data.erros
      ? data.erros.map(e => e.mensagem).join('; ')
      : data.mensagem || `Erro HTTP ${response.status}`

    return {
      status: 'erro',
      mensagem_erro: errorMsg,
      ref,
      raw_response: data as unknown as Record<string, unknown>,
    }
  }

  return {
    status: mapFocusStatus(data.status),
    numero_nfse: data.numero,
    codigo_verificacao: data.codigo_verificacao,
    url_nfse: data.url,
    url_xml: data.caminho_xml_nota_fiscal,
    url_pdf: data.caminho_danfe,
    ref: data.ref || ref,
    raw_response: data as unknown as Record<string, unknown>,
  }
}

/**
 * Consultar NFS-e via Focus NFe
 *
 * GET /v2/nfse/{ref}
 */
export async function consultarNfse(
  ref: string,
  apiKey?: string,
  environment?: string,
): Promise<NfseResult> {
  const baseUrl = getBaseUrlFromConfig(environment)
  const auth = getAuthHeader(apiKey)

  const url = `${baseUrl}/v2/nfse/${encodeURIComponent(ref)}`

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: auth,
    },
  })

  if (!response.ok) {
    if (response.status === 404) {
      return {
        status: 'erro',
        mensagem_erro: 'NFS-e nao encontrada no provedor',
        ref,
      }
    }
    return {
      status: 'erro',
      mensagem_erro: `Erro ao consultar: HTTP ${response.status}`,
      ref,
    }
  }

  const data: FocalNfseResponse = await response.json()

  return {
    status: mapFocusStatus(data.status),
    numero_nfse: data.numero,
    codigo_verificacao: data.codigo_verificacao,
    url_nfse: data.url,
    url_xml: data.caminho_xml_nota_fiscal,
    url_pdf: data.caminho_danfe,
    ref: data.ref || ref,
    raw_response: data as unknown as Record<string, unknown>,
  }
}

/**
 * Cancelar NFS-e via Focus NFe
 *
 * DELETE /v2/nfse/{ref}
 * Body: { justificativa: string }
 */
export async function cancelarNfse(
  ref: string,
  justificativa: string,
  apiKey?: string,
  environment?: string,
): Promise<void> {
  const baseUrl = getBaseUrlFromConfig(environment)
  const auth = getAuthHeader(apiKey)

  if (!justificativa || justificativa.trim().length < 15) {
    throw new Error('Justificativa deve ter no minimo 15 caracteres')
  }

  const url = `${baseUrl}/v2/nfse/${encodeURIComponent(ref)}`

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

/**
 * Testar conexao com Focus NFe
 * Faz um GET simples para verificar se a API key esta valida
 */
export async function testarConexao(
  apiKey: string,
  environment: string,
): Promise<{ ok: boolean; message: string }> {
  const baseUrl = getBaseUrlFromConfig(environment)
  const auth = getAuthHeader(apiKey)

  try {
    // Focus NFe nao tem endpoint de health check,
    // mas podemos tentar listar NFSe (vai retornar lista vazia se nao houver)
    const url = `${baseUrl}/v2/nfse?complete=0`

    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: auth },
    })

    if (response.status === 403 || response.status === 401) {
      return { ok: false, message: 'API key invalida ou sem permissao' }
    }

    if (response.ok || response.status === 200) {
      return { ok: true, message: 'Conexao estabelecida com sucesso' }
    }

    return { ok: false, message: `Resposta inesperada: HTTP ${response.status}` }
  } catch (err: any) {
    return { ok: false, message: `Falha na conexao: ${err.message}` }
  }
}

/**
 * Mapeia status do Focus NFe para status interno do PontualERP
 */
export { mapToInternalStatus }
