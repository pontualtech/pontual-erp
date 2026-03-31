/**
 * Integração direta com o Web Service da Prefeitura de São Paulo
 * NFS-e — Nota Fiscal de Serviço Eletrônica
 *
 * Padrão: SOAP + XML assinado digitalmente (XMLDSig)
 * Documentação: Manual de integração do contribuinte — Prefeitura de SP
 * Custo: ZERO (web service oficial gratuito)
 */

import { gerarXmlRPS, gerarXmlCancelamento, gerarXmlConsulta } from './sp-xml-builder'
import { assinarXml } from './xml-signer'
import { parseStringPromise } from 'xml2js'
import https from 'https'
import forge from 'node-forge'
import type { PrefeituraSPNfseInput, PrefeituraSPNfseResult, PrestadorConfig } from './types'

// ====== Endpoints da Prefeitura de SP ======

const ENDPOINTS = {
  homologacao: 'https://nfe.prefeitura.sp.gov.br/ws/lotenfe.asmx',
  producao: 'https://nfe.prefeitura.sp.gov.br/ws/lotenfe.asmx',
}

// SOAP Actions
const SOAP_ACTIONS = {
  envioRPS: 'http://www.prefeitura.sp.gov.br/nfe/ws/envioRPS',
  envioLoteRPS: 'http://www.prefeitura.sp.gov.br/nfe/ws/envioLoteRPS',
  testeEnvioLoteRPS: 'http://www.prefeitura.sp.gov.br/nfe/ws/testeEnvioLoteRPS',
  consultaNFe: 'http://www.prefeitura.sp.gov.br/nfe/ws/consultaNFe',
  cancelamentoNFe: 'http://www.prefeitura.sp.gov.br/nfe/ws/cancelamentoNFe',
  consultaLote: 'http://www.prefeitura.sp.gov.br/nfe/ws/consultaLote',
  consultaCNPJ: 'http://www.prefeitura.sp.gov.br/nfe/ws/consultaCNPJ',
}

// ====== SOAP Envelope ======

function wrapSOAP(soapAction: string, xmlContent: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${soapAction.split('/').pop()}Request xmlns="http://www.prefeitura.sp.gov.br/nfe">
      <VersaoSchema>1</VersaoSchema>
      <MensagemXML><![CDATA[${xmlContent}]]></MensagemXML>
    </${soapAction.split('/').pop()}Request>
  </soap:Body>
</soap:Envelope>`
}

// ====== Enviar requisição SOAP ======

/**
 * Converter PFX (base64) → PEM (key + cert) via node-forge
 * Node.js nativo pode não suportar certos formatos .pfx,
 * então convertemos para PEM primeiro.
 */
function pfxToPem(pfxBase64: string, password: string): { keyPem: string; certPem: string } {
  const pfxDer = forge.util.decode64(pfxBase64)
  const pfxAsn1 = forge.asn1.fromDer(pfxDer)
  const p12 = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, password)

  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })
  const key = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]?.key
  if (!key) throw new Error('Chave privada não encontrada no certificado')

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })
  const cert = certBags[forge.pki.oids.certBag]?.[0]?.cert
  if (!cert) throw new Error('Certificado não encontrado no arquivo .pfx')

  return {
    keyPem: forge.pki.privateKeyToPem(key),
    certPem: forge.pki.certificateToPem(cert),
  }
}

/**
 * Enviar requisição SOAP com mTLS (certificado do cliente)
 *
 * A Prefeitura de SP exige autenticação mútua (mTLS):
 * o certificado A1 precisa ser enviado na conexão HTTPS,
 * não apenas para assinar o XML.
 */
async function enviarSOAP(
  endpoint: string,
  soapAction: string,
  xmlContent: string,
  pfxBase64: string,
  pfxPassword: string
): Promise<string> {
  const soapEnvelope = wrapSOAP(soapAction, xmlContent)

  // Converter PFX → PEM (compatibilidade garantida)
  const { keyPem, certPem } = pfxToPem(pfxBase64, pfxPassword)

  return new Promise((resolve, reject) => {
    const url = new URL(endpoint)

    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'Content-Length': Buffer.byteLength(soapEnvelope, 'utf8'),
        SOAPAction: soapAction,
      },
      key: keyPem,
      cert: certPem,
      rejectUnauthorized: false,
    }

    const req = https.request(options, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`SOAP Error ${res.statusCode}: ${body.substring(0, 500)}`))
        } else {
          resolve(body)
        }
      })
    })

    req.on('error', (e) => reject(new Error(`Erro de conexão com a Prefeitura: ${e.message}`)))
    req.write(soapEnvelope)
    req.end()
  })
}

// ====== Parsear resposta SOAP ======

async function parsearRespostaSP(soapXml: string): Promise<any> {
  // A prefeitura retorna o XML real dentro de <RetornoXML> como HTML-escaped string
  // Extrair e decodificar o conteúdo de RetornoXML
  const retornoMatch = soapXml.match(/<RetornoXML>([\s\S]*?)<\/RetornoXML>/)
  if (!retornoMatch) {
    // Tentar parsear o SOAP inteiro
    const parsed = await parseStringPromise(soapXml, { explicitArray: false, ignoreAttrs: false })
    return parsed
  }

  // Decodificar HTML entities
  let retornoXml = retornoMatch[1]
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')

  const parsed = await parseStringPromise(retornoXml, {
    explicitArray: false,
    ignoreAttrs: false,
    tagNameProcessors: [(name: string) => name.replace(/.*:/, '')],
  })

  return parsed
}

function extrairRetornoNFSe(body: any): {
  sucesso: boolean
  numero_nfse?: string
  codigo_verificacao?: string
  data_emissao?: string
  link_nfse?: string
  erros?: Array<{ codigo: string; mensagem: string }>
} {
  try {
    // Após parsearRespostaSP, body é o conteúdo de RetornoXML (ex: RetornoEnvioRPS)
    const retorno =
      body.RetornoEnvioRPS ||
      body.RetornoEnvioLoteRPS ||
      body.RetornoConsultaNFe ||
      body.RetornoCancelamentoNFe ||
      body.RetornoConsultaCNPJ ||
      body

    // Verificar sucesso
    const cabecalho = retorno.Cabecalho || retorno['Cabecalho']
    const sucesso = cabecalho?.Sucesso === 'true' || cabecalho?.['$']?.Sucesso === 'true'

    if (sucesso || retorno.ChaveNFeRPS) {
      const chave = retorno.ChaveNFeRPS?.ChaveNFe || retorno.ChaveNFeRPS
      return {
        sucesso: true,
        numero_nfse: chave?.NumeroNFe || retorno.Cabecalho?.NumeroNFe,
        codigo_verificacao: chave?.CodigoVerificacao,
        data_emissao: chave?.DataEmissaoRPS || new Date().toISOString(),
        link_nfse: chave?.NumeroNFe
          ? `https://nfe.prefeitura.sp.gov.br/contribuinte/notaprint.aspx?ccm=${chave.InscricaoPrestador}&nf=${chave.NumeroNFe}&cod=${chave.CodigoVerificacao}`
          : undefined,
      }
    }

    // Extrair erros
    const alertas = retorno.Alerta || retorno.Erro || retorno.ListaMensagemRetorno?.MensagemRetorno
    const erros: Array<{ codigo: string; mensagem: string }> = []

    if (alertas) {
      const lista = Array.isArray(alertas) ? alertas : [alertas]
      for (const a of lista) {
        erros.push({
          codigo: a.Codigo || a.codigo || '?',
          mensagem: a.Descricao || a.Mensagem || a.descricao || JSON.stringify(a),
        })
      }
    }

    return { sucesso: false, erros: erros.length > 0 ? erros : [{ codigo: '?', mensagem: 'Resposta inesperada da prefeitura' }] }
  } catch (e: any) {
    return { sucesso: false, erros: [{ codigo: 'PARSE', mensagem: e.message }] }
  }
}

// ====== API PÚBLICA ======

export interface PrefeituraSPConfig {
  environment: 'homologacao' | 'producao'
  cnpj: string
  inscricaoMunicipal: string
  certificateBase64: string
  certificatePassword: string
}

/**
 * Emitir NFS-e via RPS na Prefeitura de SP
 */
export async function emitirNfseSP(
  input: PrefeituraSPNfseInput,
  prestador: PrestadorConfig,
  config: PrefeituraSPConfig
): Promise<PrefeituraSPNfseResult> {
  const endpoint = ENDPOINTS[config.environment]

  // 0. Extrair chave privada PEM (para assinar RPS hash)
  const { keyPem } = pfxToPem(config.certificateBase64, config.certificatePassword)

  // 1. Gerar XML do RPS
  const xmlRPS = gerarXmlRPS({
    inscricaoPrestador: config.inscricaoMunicipal,
    cnpjPrestador: config.cnpj,
    privateKeyPem: keyPem,
    serieRPS: 'NF',
    numeroRPS: input.numero_rps || 1,
    dataEmissao: new Date().toISOString().substring(0, 10),
    valorServicos: input.valor_servicos,
    valorDeducoes: input.valor_deducoes || 0,
    codigoServico: input.codigo_servico,
    aliquota: input.aliquota_iss || 0.05,
    issRetido: input.iss_retido || false,
    discriminacao: input.discriminacao,
    tomador: {
      cpfCnpj: input.tomador_cpf_cnpj,
      tipoPessoa: input.tomador_cpf_cnpj.length <= 11 ? 'CPF' : 'CNPJ',
      razaoSocial: input.tomador_razao_social,
      email: input.tomador_email,
      logradouro: input.tomador_logradouro,
      numero: input.tomador_numero,
      bairro: input.tomador_bairro,
      cidade: input.tomador_cidade || '3550308', // São Paulo
      uf: input.tomador_uf || 'SP',
      cep: input.tomador_cep,
    },
  })

  // 2. Assinar o XML com certificado A1
  let xmlAssinado: string
  try {
    xmlAssinado = await assinarXml(
      xmlRPS,
      config.certificateBase64,
      config.certificatePassword
    )
  } catch (e: any) {
    return {
      sucesso: false,
      status: 'erro_assinatura',
      erros: [{ codigo: 'CERT', mensagem: `Erro ao assinar XML: ${e.message}` }],
    }
  }

  // 3. Enviar via SOAP
  const isTest = config.environment === 'homologacao'
  const soapAction = isTest ? SOAP_ACTIONS.testeEnvioLoteRPS : SOAP_ACTIONS.envioRPS

  let respostaXml: string
  try {
    respostaXml = await enviarSOAP(endpoint, soapAction, xmlAssinado, config.certificateBase64, config.certificatePassword)
  } catch (e: any) {
    return {
      sucesso: false,
      status: 'erro_comunicacao',
      erros: [{ codigo: 'SOAP', mensagem: e.message }],
    }
  }

  // 4. Parsear resposta
  const body = await parsearRespostaSP(respostaXml)
  const retorno = extrairRetornoNFSe(body)

  if (retorno.sucesso) {
    return {
      sucesso: true,
      status: 'autorizado',
      numero_nfse: retorno.numero_nfse,
      codigo_verificacao: retorno.codigo_verificacao,
      data_emissao: retorno.data_emissao,
      link_nfse: retorno.link_nfse,
      xml_resposta: respostaXml,
    }
  }

  return {
    sucesso: false,
    status: 'rejeitado',
    erros: retorno.erros,
    xml_resposta: respostaXml,
  }
}

/**
 * Consultar NFS-e na Prefeitura de SP
 */
export async function consultarNfseSP(
  numeroNfse: string,
  config: PrefeituraSPConfig
): Promise<PrefeituraSPNfseResult> {
  const xmlConsulta = gerarXmlConsulta({
    cnpj: config.cnpj,
    inscricaoMunicipal: config.inscricaoMunicipal,
    numeroNfse,
  })

  const xmlAssinado = await assinarXml(
    xmlConsulta,
    config.certificateBase64,
    config.certificatePassword
  )

  const respostaXml = await enviarSOAP(
    ENDPOINTS[config.environment],
    SOAP_ACTIONS.consultaNFe,
    xmlAssinado,
    config.certificateBase64,
    config.certificatePassword
  )

  const body = await parsearRespostaSP(respostaXml)
  const retorno = extrairRetornoNFSe(body)

  return {
    sucesso: retorno.sucesso,
    status: retorno.sucesso ? 'autorizado' : 'erro_consulta',
    numero_nfse: retorno.numero_nfse,
    codigo_verificacao: retorno.codigo_verificacao,
    xml_resposta: respostaXml,
  }
}

/**
 * Cancelar NFS-e na Prefeitura de SP
 */
export async function cancelarNfseSP(
  numeroNfse: string,
  config: PrefeituraSPConfig
): Promise<PrefeituraSPNfseResult> {
  const xmlCancelamento = gerarXmlCancelamento({
    cnpj: config.cnpj,
    inscricaoMunicipal: config.inscricaoMunicipal,
    numeroNfse,
  })

  const xmlAssinado = await assinarXml(
    xmlCancelamento,
    config.certificateBase64,
    config.certificatePassword
  )

  const respostaXml = await enviarSOAP(
    ENDPOINTS[config.environment],
    SOAP_ACTIONS.cancelamentoNFe,
    xmlAssinado,
    config.certificateBase64,
    config.certificatePassword
  )

  const body = await parsearRespostaSP(respostaXml)
  const retorno = extrairRetornoNFSe(body)

  return {
    sucesso: retorno.sucesso,
    status: retorno.sucesso ? 'cancelado' : 'erro_cancelamento',
    xml_resposta: respostaXml,
  }
}

/**
 * Testar conexão com a Prefeitura de SP
 */
export async function testarConexaoSP(
  config: PrefeituraSPConfig
): Promise<{ ok: boolean; message: string }> {
  try {
    // Usar ConsultaCNPJ como teste de conectividade
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<p1:PedidoConsultaCNPJ xmlns:p1="http://www.prefeitura.sp.gov.br/nfe" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Cabecalho Versao="1">
    <CPFCNPJRemetente>
      <CNPJ>${config.cnpj}</CNPJ>
    </CPFCNPJRemetente>
  </Cabecalho>
  <CNPJContribuinte>
    <CNPJ>${config.cnpj}</CNPJ>
  </CNPJContribuinte>
</p1:PedidoConsultaCNPJ>`

    const xmlAssinado = await assinarXml(xml, config.certificateBase64, config.certificatePassword)

    await enviarSOAP(
      ENDPOINTS[config.environment],
      SOAP_ACTIONS.consultaCNPJ,
      xmlAssinado,
      config.certificateBase64,
      config.certificatePassword
    )

    return { ok: true, message: 'Conexão com a Prefeitura de SP estabelecida com sucesso!' }
  } catch (e: any) {
    return { ok: false, message: `Erro: ${e.message}` }
  }
}
