/**
 * NFS-e (Nota Fiscal de Servicos Eletronica) types
 * Used with Focus NFe API provider
 */

export interface PrestadorConfig {
  cnpj: string
  inscricao_municipal: string
  codigo_municipio: string
}

export interface EnderecoTomador {
  logradouro: string
  numero: string
  bairro: string
  codigo_municipio: string
  uf: string
  cep: string
}

export interface NfseInput {
  razao_social_tomador: string
  cnpj_tomador?: string
  cpf_tomador?: string
  endereco_tomador: EnderecoTomador
  servico: {
    discriminacao: string
    valor_servicos: number // em REAIS (Focus NFe espera reais, nao centavos)
    aliquota: number // ex: 2.9
    item_lista_servico: string // ex: "0107"
    iss_retido: boolean
    codigo_municipio: string
  }
  data_emissao?: string // ISO date string
}

export interface NfseResult {
  status: 'processando' | 'autorizada' | 'erro' | 'cancelada'
  numero_nfse?: string
  codigo_verificacao?: string
  url_nfse?: string
  url_xml?: string
  url_pdf?: string
  mensagem_erro?: string
  ref: string
  raw_response?: Record<string, unknown>
}

export interface NfseCancelInput {
  justificativa: string
}

export interface FocusNfsePayload {
  data_emissao?: string
  prestador: {
    cnpj: string
    inscricao_municipal: string
    codigo_municipio: string
  }
  tomador: {
    cpf_cnpj: string
    razao_social: string
    endereco: {
      logradouro: string
      numero: string
      bairro: string
      codigo_municipio: string
      uf: string
      cep: string
    }
  }
  servico: {
    aliquota: number
    discriminacao: string
    iss_retido: boolean
    item_lista_servico: string
    valor_servicos: number
    codigo_municipio: string
  }
}

export interface FocalNfseResponse {
  ref?: string
  status?: string
  numero?: string
  codigo_verificacao?: string
  caminho_xml_nota_fiscal?: string
  caminho_danfe?: string
  url?: string
  mensagem?: string
  erros?: Array<{ mensagem: string; codigo: string }>
}

/** Status mapping from Focus NFe to internal */
export const FOCUS_STATUS_MAP: Record<string, string> = {
  autorizado: 'AUTHORIZED',
  cancelado: 'CANCELLED',
  erro_autorizacao: 'REJECTED',
  denegado: 'REJECTED',
  processando_autorizacao: 'PROCESSING',
} as const

/** Internal status colors for UI */
export const NFSE_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  DRAFT: { label: 'Rascunho', color: 'bg-gray-100 text-gray-700' },
  PROCESSING: { label: 'Processando', color: 'bg-yellow-100 text-yellow-700' },
  AUTHORIZED: { label: 'Autorizada', color: 'bg-green-100 text-green-700' },
  REJECTED: { label: 'Rejeitada', color: 'bg-red-100 text-red-700' },
  CANCELLED: { label: 'Cancelada', color: 'bg-gray-100 text-gray-600' },
} as const
