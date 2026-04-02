/**
 * Cliente SOAP para comunicação com Web Services da SEFAZ
 * Usa mTLS (certificado A1) para autenticação
 *
 * IMPORTANTE: O WSDL da SEFAZ define nfeDadosMsg como xs:string,
 * mas na prática aceita XML literal (não escapado) dentro do CDATA ou direto.
 * O padrão que funciona é XML direto dentro de nfeDadosMsg sem CDATA.
 */
import https from 'https'

interface SoapRequest {
  url: string
  action: string
  body: string       // XML da requisição (vai dentro de nfeDadosMsg)
  privateKeyPem: string
  certificatePem: string
  timeout?: number
}

// Mapa SOAPAction method name → WSDL namespace
const SERVICES: Record<string, { xmlns: string; method: string }> = {
  'nfeAutorizacaoLote':    { xmlns: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4', method: 'nfeAutorizacaoLote' },
  'nfeRetAutorizacaoLote': { xmlns: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRetAutorizacao4', method: 'nfeRetAutorizacaoLote' },
  'nfeConsultaNF':         { xmlns: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4', method: 'nfeConsultaNF' },
  'nfeInutilizacaoNF':     { xmlns: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeInutilizacao4', method: 'nfeInutilizacaoNF' },
  'nfeRecepcaoEvento':     { xmlns: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4', method: 'nfeRecepcaoEvento' },
  'nfeStatusServicoNF':    { xmlns: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4', method: 'nfeStatusServicoNF' },
  'nfeDistDFeInteresse':   { xmlns: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe', method: 'nfeDistDFeInteresse' },
}

function getService(action: string): { xmlns: string; method: string } {
  for (const [key, svc] of Object.entries(SERVICES)) {
    if (action.includes(key)) return svc
  }
  return { xmlns: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4', method: 'nfeDadosMsg' }
}

/**
 * Monta envelope SOAP 1.2 conforme padrão SEFAZ
 *
 * Formato:
 * <soap12:Envelope>
 *   <soap12:Body>
 *     <nfeDistDFeInteresse xmlns="http://...">
 *       <nfeDadosMsg>
 *         <distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
 *           ...
 *         </distDFeInt>
 *       </nfeDadosMsg>
 *     </nfeDistDFeInteresse>
 *   </soap12:Body>
 * </soap12:Envelope>
 */
function buildEnvelope(xmlBody: string, action: string): string {
  const svc = getService(action)
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">',
    '<soap12:Body>',
    `<${svc.method} xmlns="${svc.xmlns}">`,
    '<nfeDadosMsg>',
    xmlBody,
    '</nfeDadosMsg>',
    `</${svc.method}>`,
    '</soap12:Body>',
    '</soap12:Envelope>',
  ].join('')
}

/**
 * Envia requisição SOAP com mTLS para a SEFAZ
 */
export async function sendSoapRequest(req: SoapRequest): Promise<string> {
  const envelope = buildEnvelope(req.body, req.action)

  const urlObj = new URL(req.url)

  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': `application/soap+xml; charset=utf-8; action="${req.action}"`,
        'Content-Length': Buffer.byteLength(envelope, 'utf-8'),
      },
      key: req.privateKeyPem,
      cert: req.certificatePem,
      rejectUnauthorized: true,
      timeout: req.timeout || 30000,
    }

    const httpReq = https.request(options, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString('utf-8')
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
          resolve(data)
        } else {
          reject(new Error(`SEFAZ HTTP ${res.statusCode}: ${data.substring(0, 500)}`))
        }
      })
    })

    httpReq.on('error', (err: any) => {
      if (err.code === 'ECONNREFUSED') reject(new Error('SEFAZ: Conexao recusada'))
      else if (err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') reject(new Error('SEFAZ: Certificado nao aceito'))
      else if (err.code === 'DEPTH_ZERO_SELF_SIGNED_CERT') reject(new Error('SEFAZ: Certificado auto-assinado'))
      else reject(new Error(`SEFAZ: ${err.code || err.message}`))
    })

    httpReq.on('timeout', () => { httpReq.destroy(); reject(new Error('SEFAZ: Timeout')) })

    httpReq.write(envelope, 'utf-8')
    httpReq.end()
  })
}

/**
 * Extrai o conteúdo do body SOAP da resposta
 */
export function extractSoapBody(soapResponse: string): string {
  const match = soapResponse.match(/<(?:soap12?:)?Body[^>]*>([\s\S]*?)<\/(?:soap12?:)?Body>/i)
  return match?.[1]?.trim() || soapResponse
}
