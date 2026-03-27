/**
 * NF-e (Nota Fiscal Eletronica de Produtos) types
 * Used with Focus NFe API provider
 */

// ---------- Emitente ----------

export interface EmitenteConfig {
  cnpj: string
  inscricao_estadual: string
  nome_fantasia?: string
  razao_social: string
  logradouro: string
  numero: string
  complemento?: string
  bairro: string
  codigo_municipio: string
  municipio: string
  uf: string
  cep: string
  telefone?: string
  regime_tributario: number // 1 = Simples Nacional
}

// ---------- Destinatario ----------

export interface EnderecoDestinatario {
  logradouro: string
  numero: string
  complemento?: string
  bairro: string
  codigo_municipio: string
  municipio: string
  uf: string
  cep: string
  pais?: string
  codigo_pais?: string
}

export interface Destinatario {
  cnpj?: string
  cpf?: string
  nome: string
  inscricao_estadual?: string
  indicador_inscricao_estadual?: number // 1=contribuinte, 2=isento, 9=nao contribuinte
  email?: string
  endereco: EnderecoDestinatario
}

// ---------- Item NF-e ----------

export interface NfeItem {
  numero_item?: number
  codigo_produto: string
  descricao: string
  cfop: number
  unidade_comercial: string
  quantidade_comercial: number
  valor_unitario_comercial: number
  valor_bruto: number
  codigo_ncm: string
  // Tributacao Simples Nacional
  icms_origem: number // 0 = Nacional
  icms_situacao_tributaria: number | string // 102 = Simples Nacional sem permissao de credito
  // PIS / COFINS
  pis_situacao_tributaria: string // "07" = Operacao isenta
  cofins_situacao_tributaria: string // "07" = Operacao isenta
  // Unidade tributavel (opcional, defaults = comercial)
  unidade_tributavel?: string
  quantidade_tributavel?: number
  valor_unitario_tributavel?: number
  // Peso (opcional)
  peso_liquido?: number
  peso_bruto?: number
}

// ---------- NF-e Input ----------

export type NfeTipo = 'venda' | 'remessa_conserto' | 'retorno_conserto' | 'devolucao'

export interface NfeInput {
  natureza_operacao: string
  tipo: NfeTipo
  destinatario: Destinatario
  items: NfeItem[]
  notas_referenciadas?: string[] // chaves NFe 44 digits
  informacoes_adicionais?: string
  modalidade_frete?: number // 0=emitente, 1=destinatario, 9=sem frete
}

// ---------- NF-e Result ----------

export interface NfeResult {
  status: string // processando_autorizacao, autorizado, erro_autorizacao, cancelado
  chave_nfe?: string
  numero?: string
  serie?: string
  url_danfe?: string
  url_xml?: string
  mensagem_sefaz?: string
  ref: string
  protocolo?: string
  raw_response?: Record<string, unknown>
}

// ---------- NF-e Recebida (MDe) ----------

export interface NfeRecebida {
  chave: string
  nome_emitente: string
  cnpj_emitente: string
  valor_total: number
  data_emissao: string
  situacao: string // 'pendente', 'ciencia', 'confirmada', 'desconhecida', 'nao_realizada'
  manifestacao?: string
  tipo_nfe?: string
  numero?: string
  serie?: string
}

export interface ManifestacaoTipo {
  tipo: 'ciencia' | 'confirmacao' | 'desconhecimento' | 'nao_realizada'
  justificativa?: string // obrigatoria para desconhecimento e nao_realizada
}

// ---------- Focus NFe API Payload ----------

export interface FocusNfePayload {
  natureza_operacao: string
  forma_pagamento?: number
  tipo_documento?: number // 0=entrada, 1=saida
  local_destino?: number // 1=operacao interna, 2=interestadual, 3=exterior
  finalidade_emissao?: number // 1=normal, 2=complementar, 3=ajuste, 4=devolucao
  consumidor_final?: number // 0=normal, 1=consumidor final
  presenca_comprador?: number // 1=presencial, 9=outros
  modalidade_frete?: number
  // Emitente
  cnpj_emitente: string
  inscricao_estadual_emitente?: string
  nome_fantasia_emitente?: string
  razao_social_emitente?: string
  logradouro_emitente?: string
  numero_emitente?: string
  complemento_emitente?: string
  bairro_emitente?: string
  codigo_municipio_emitente?: string
  municipio_emitente?: string
  uf_emitente?: string
  cep_emitente?: string
  telefone_emitente?: string
  regime_tributario_emitente?: number // 1=Simples Nacional
  // Destinatario
  cnpj_destinatario?: string
  cpf_destinatario?: string
  nome_destinatario: string
  inscricao_estadual_destinatario?: string
  indicador_inscricao_estadual_destinatario?: number
  email_destinatario?: string
  logradouro_destinatario: string
  numero_destinatario: string
  complemento_destinatario?: string
  bairro_destinatario: string
  codigo_municipio_destinatario: string
  municipio_destinatario: string
  uf_destinatario: string
  cep_destinatario: string
  // NF-e referenciadas
  notas_referenciadas?: Array<{ chave_nfe: string }>
  // Informacoes adicionais
  informacoes_adicionais_contribuinte?: string
  // Items
  items: FocusNfeItemPayload[]
}

export interface FocusNfeItemPayload {
  numero_item: number
  codigo_produto: string
  descricao: string
  cfop: number
  unidade_comercial: string
  quantidade_comercial: number
  valor_unitario_comercial: number
  valor_bruto: number
  codigo_ncm: string
  unidade_tributavel: string
  quantidade_tributavel: number
  valor_unitario_tributavel: number
  icms_origem: number
  icms_situacao_tributaria: number | string
  icms_modalidade_base_calculo?: number
  icms_valor?: number
  icms_base_calculo?: number
  icms_aliquota?: number
  pis_situacao_tributaria: string
  cofins_situacao_tributaria: string
  peso_liquido?: number
  peso_bruto?: number
}

export interface FocusNfeResponse {
  ref?: string
  status?: string
  status_sefaz?: string
  mensagem_sefaz?: string
  chave_nfe?: string
  numero?: string
  serie?: string
  caminho_xml_nota_fiscal?: string
  caminho_danfe?: string
  protocolo?: string
  erros?: Array<{ mensagem: string; codigo?: string }>
  mensagem?: string
}

// ---------- Status mapping ----------

export const FOCUS_NFE_STATUS_MAP: Record<string, string> = {
  autorizado: 'AUTHORIZED',
  cancelado: 'CANCELLED',
  erro_autorizacao: 'REJECTED',
  denegado: 'REJECTED',
  processando_autorizacao: 'PROCESSING',
} as const

export const NFE_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  DRAFT: { label: 'Rascunho', color: 'bg-gray-100 text-gray-700' },
  PROCESSING: { label: 'Processando', color: 'bg-yellow-100 text-yellow-700' },
  AUTHORIZED: { label: 'Autorizada', color: 'bg-green-100 text-green-700' },
  REJECTED: { label: 'Rejeitada', color: 'bg-red-100 text-red-700' },
  CANCELLED: { label: 'Cancelada', color: 'bg-gray-100 text-gray-600' },
} as const

// ---------- CFOP defaults by tipo ----------

export const NFE_TIPO_CONFIG: Record<NfeTipo, {
  natureza_operacao: string
  cfop: number
  finalidade_emissao: number
  icms_situacao_tributaria: number | string
  informacoes_adicionais?: string
}> = {
  venda: {
    natureza_operacao: 'Venda de mercadoria',
    cfop: 5102,
    finalidade_emissao: 1,
    icms_situacao_tributaria: 102,
  },
  remessa_conserto: {
    natureza_operacao: 'Remessa para conserto',
    cfop: 5915,
    finalidade_emissao: 1,
    icms_situacao_tributaria: 400,
    informacoes_adicionais: 'Remessa para conserto. ICMS suspenso conforme Art. 327 do RICMS/SP.',
  },
  retorno_conserto: {
    natureza_operacao: 'Retorno de mercadoria recebida para conserto',
    cfop: 5916,
    finalidade_emissao: 1,
    icms_situacao_tributaria: 400,
    informacoes_adicionais: 'Retorno de mercadoria recebida para conserto. ICMS suspenso conforme Art. 327 do RICMS/SP.',
  },
  devolucao: {
    natureza_operacao: 'Devolucao de mercadoria',
    cfop: 5202,
    finalidade_emissao: 4,
    icms_situacao_tributaria: 102,
  },
}
