/**
 * Gerador de XML para NFS-e da Prefeitura de São Paulo
 *
 * Formato: Layout paulistano (diferente do ABRASF nacional)
 * Referência: Manual de integração do contribuinte — Prefeitura de SP
 */

import crypto from 'crypto'

// ====== Tipos ======

export interface RPSInput {
  inscricaoPrestador: string
  cnpjPrestador: string
  serieRPS: string
  numeroRPS: number
  dataEmissao: string  // YYYY-MM-DD
  valorServicos: number // em reais (ex: 150.00)
  valorDeducoes: number
  codigoServico: string // ex: "02496"
  aliquota: number      // ex: 0.05 = 5%
  issRetido: boolean
  discriminacao: string
  tomador: {
    cpfCnpj: string
    tipoPessoa: 'CPF' | 'CNPJ'
    razaoSocial: string
    email?: string
    logradouro?: string
    numero?: string
    bairro?: string
    cidade?: string     // codigo IBGE, ex: "3550308"
    uf?: string
    cep?: string
  }
}

// ====== Helpers ======

function pad(value: string | number, length: number, char = '0', side: 'left' | 'right' = 'left'): string {
  const str = String(value)
  if (side === 'right') return str.padEnd(length, char)
  return str.padStart(length, char)
}

function formatarValor(valor: number): string {
  return valor.toFixed(2)
}

function limparCpfCnpj(doc: string): string {
  return doc.replace(/[.\-\/]/g, '')
}

function escaparXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Gerar a assinatura do RPS (hash SHA-1 dos campos concatenados)
 *
 * Formato da string para hash (conforme manual SP):
 * InscricaoPrestador(8) + SerieRPS(5 right) + NumeroRPS(12 zero) +
 * DataEmissao(AAAAMMDD) + TributacaoRPS(1) + StatusRPS(1) +
 * ISSRetido(1: S/N) + ValorServicos(15 zero centavos) +
 * ValorDeducoes(15 zero centavos) + CodigoServico(5) +
 * IndicadorCPFCNPJ(1: 1=CPF, 2=CNPJ, 3=none) +
 * CPFCNPJTomador(14 zero)
 */
function gerarAssinaturaRPS(input: RPSInput): string {
  const inscricao = pad(input.inscricaoPrestador, 8)
  const serie = pad(input.serieRPS, 5, ' ', 'right')
  const numero = pad(input.numeroRPS, 12)
  const data = input.dataEmissao.replace(/-/g, '') // AAAAMMDD

  // TributacaoRPS: T=Tributado no municipio, F=Fora do municipio, etc
  const tributacao = 'T'
  const status = 'N' // N=Normal
  const issRetido = input.issRetido ? 'S' : 'N'

  // Valores em centavos, 15 dígitos
  const valorServicos = pad(Math.round(input.valorServicos * 100), 15)
  const valorDeducoes = pad(Math.round(input.valorDeducoes * 100), 15)

  const codigoServico = pad(input.codigoServico, 5)

  // Indicador: 1=CPF, 2=CNPJ, 3=sem tomador
  const docLimpo = limparCpfCnpj(input.tomador.cpfCnpj)
  let indicador: string
  let cpfCnpj: string
  if (!docLimpo) {
    indicador = '3'
    cpfCnpj = pad('', 14)
  } else if (docLimpo.length <= 11) {
    indicador = '1'
    cpfCnpj = pad(docLimpo, 14)
  } else {
    indicador = '2'
    cpfCnpj = pad(docLimpo, 14)
  }

  const stringParaHash =
    inscricao + serie + numero + data + tributacao + status +
    issRetido + valorServicos + valorDeducoes + codigoServico +
    indicador + cpfCnpj

  // SHA-1 hash (hexadecimal)
  return crypto.createHash('sha1').update(stringParaHash, 'ascii').digest('hex')
}

// ====== Geradores de XML ======

/**
 * Gerar XML do PedidoEnvioRPS (envio de RPS individual)
 */
export function gerarXmlRPS(input: RPSInput): string {
  const assinatura = gerarAssinaturaRPS(input)
  const docTomador = limparCpfCnpj(input.tomador.cpfCnpj)
  const isCPF = docTomador.length <= 11

  let enderecoXml = ''
  if (input.tomador.logradouro) {
    enderecoXml = `
    <EnderecoTomador>
      <Logradouro>${escaparXml(input.tomador.logradouro || '')}</Logradouro>
      <NumeroEndereco>${escaparXml(input.tomador.numero || 'S/N')}</NumeroEndereco>
      <Bairro>${escaparXml(input.tomador.bairro || '')}</Bairro>
      <Cidade>${input.tomador.cidade || '3550308'}</Cidade>
      <UF>${input.tomador.uf || 'SP'}</UF>
      <CEP>${limparCpfCnpj(input.tomador.cep || '')}</CEP>
    </EnderecoTomador>`
  }

  let emailXml = ''
  if (input.tomador.email) {
    emailXml = `\n    <EmailTomador>${escaparXml(input.tomador.email)}</EmailTomador>`
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<PedidoEnvioRPS xmlns="http://www.prefeitura.sp.gov.br/nfe">
  <Cabecalho Versao="1">
    <CPFCNPJRemetente>
      <CNPJ>${limparCpfCnpj(input.cnpjPrestador)}</CNPJ>
    </CPFCNPJRemetente>
  </Cabecalho>
  <RPS>
    <Assinatura>${assinatura}</Assinatura>
    <ChaveRPS>
      <InscricaoPrestador>${pad(input.inscricaoPrestador, 8)}</InscricaoPrestador>
      <SerieRPS>${escaparXml(input.serieRPS)}</SerieRPS>
      <NumeroRPS>${input.numeroRPS}</NumeroRPS>
    </ChaveRPS>
    <TipoRPS>RPS</TipoRPS>
    <DataEmissao>${input.dataEmissao}</DataEmissao>
    <StatusRPS>N</StatusRPS>
    <TributacaoRPS>T</TributacaoRPS>
    <ValorServicos>${formatarValor(input.valorServicos)}</ValorServicos>
    <ValorDeducoes>${formatarValor(input.valorDeducoes)}</ValorDeducoes>
    <CodigoServico>${pad(input.codigoServico, 5)}</CodigoServico>
    <AliquotaServicos>${input.aliquota.toFixed(4)}</AliquotaServicos>
    <ISSRetido>${input.issRetido ? 'true' : 'false'}</ISSRetido>
    <CPFCNPJTomador>
      <${isCPF ? 'CPF' : 'CNPJ'}>${docTomador}</${isCPF ? 'CPF' : 'CNPJ'}>
    </CPFCNPJTomador>
    <RazaoSocialTomador>${escaparXml(input.tomador.razaoSocial)}</RazaoSocialTomador>${enderecoXml}${emailXml}
    <Discriminacao>${escaparXml(input.discriminacao)}</Discriminacao>
  </RPS>
</PedidoEnvioRPS>`
}

/**
 * Gerar XML de consulta NFS-e
 */
export function gerarXmlConsulta(params: {
  cnpj: string
  inscricaoMunicipal: string
  numeroNfse: string
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<PedidoConsultaNFe xmlns="http://www.prefeitura.sp.gov.br/nfe">
  <Cabecalho Versao="1">
    <CPFCNPJRemetente>
      <CNPJ>${limparCpfCnpj(params.cnpj)}</CNPJ>
    </CPFCNPJRemetente>
  </Cabecalho>
  <Detalhe>
    <ChaveNFe>
      <InscricaoPrestador>${pad(params.inscricaoMunicipal, 8)}</InscricaoPrestador>
      <NumeroNFe>${params.numeroNfse}</NumeroNFe>
    </ChaveNFe>
  </Detalhe>
</PedidoConsultaNFe>`
}

/**
 * Gerar XML de cancelamento NFS-e
 */
export function gerarXmlCancelamento(params: {
  cnpj: string
  inscricaoMunicipal: string
  numeroNfse: string
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<PedidoCancelamentoNFe xmlns="http://www.prefeitura.sp.gov.br/nfe">
  <Cabecalho Versao="1">
    <CPFCNPJRemetente>
      <CNPJ>${limparCpfCnpj(params.cnpj)}</CNPJ>
    </CPFCNPJRemetente>
  </Cabecalho>
  <Detalhe>
    <ChaveNFe>
      <InscricaoPrestador>${pad(params.inscricaoMunicipal, 8)}</InscricaoPrestador>
      <NumeroNFe>${params.numeroNfse}</NumeroNFe>
    </ChaveNFe>
  </Detalhe>
</PedidoCancelamentoNFe>`
}
