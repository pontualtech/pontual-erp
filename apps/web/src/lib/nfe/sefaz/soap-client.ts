/**
 * Cliente SOAP para comunicação com Web Services da SEFAZ
 * Usa mTLS (certificado A1) para autenticação
 */
import https from 'https'

interface SoapRequest {
  url: string
  action: string
  body: string
  privateKeyPem: string
  certificatePem: string
  timeout?: number
}

// Mapa SOAPAction → namespace do serviço
const ACTION_NAMESPACE: Record<string, string> = {
  'nfeAutorizacaoLote': 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4',
  'nfeRetAutorizacaoLote': 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRetAutorizacao4',
  'nfeConsultaNF': 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4',
  'nfeInutilizacaoNF': 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeInutilizacao4',
  'nfeRecepcaoEvento': 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4',
  'nfeStatusServicoNF': 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4',
  'nfeDistDFeInteresse': 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe',
}

function getNamespace(action: string): string {
  for (const [key, ns] of Object.entries(ACTION_NAMESPACE)) {
    if (action.includes(key)) return ns
  }
  return 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4'
}

function wrapSoapEnvelope(body: string, xmlns: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Header/>
  <soap12:Body>
    <nfeDadosMsg xmlns="${xmlns}">
      ${body}
    </nfeDadosMsg>
  </soap12:Body>
</soap12:Envelope>`
}

export async function sendSoapRequest(req: SoapRequest): Promise<string> {
  const xmlns = getNamespace(req.action)
  const envelope = wrapSoapEnvelope(req.body, xmlns)

  const urlObj = new URL(req.url)

  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': `application/soap+xml; charset=utf-8; action="${req.action}"`,
        'Content-Length': Buffer.byteLength(envelope),
      },
      key: req.privateKeyPem,
      cert: req.certificatePem,
      rejectUnauthorized: true,
      timeout: req.timeout || 30000,
    }

    const httpReq = https.request(options, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
          resolve(data)
        } else {
          reject(new Error(`SEFAZ HTTP ${res.statusCode}: ${data.substring(0, 500)}`))
        }
      })
    })

    httpReq.on('error', (err: any) => {
      if (err.code === 'ECONNREFUSED') reject(new Error('SEFAZ: Conexão recusada. Verifique o certificado.'))
      else if (err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') reject(new Error('SEFAZ: Certificado não aceito. Verifique validade e CA.'))
      else if (err.code === 'ERR_TLS_CERT_ALTNAME_INVALID') reject(new Error('SEFAZ: Nome do certificado não bate com o servidor.'))
      else reject(new Error(`SEFAZ: ${err.code || err.message}`))
    })

    httpReq.on('timeout', () => { httpReq.destroy(); reject(new Error('SEFAZ: Timeout (30s)')) })

    httpReq.write(envelope)
    httpReq.end()
  })
}

export function extractSoapBody(soapResponse: string): string {
  const match = soapResponse.match(/<(?:soap12?:)?Body[^>]*>([\s\S]*?)<\/(?:soap12?:)?Body>/i)
  return match?.[1]?.trim() || soapResponse
}
