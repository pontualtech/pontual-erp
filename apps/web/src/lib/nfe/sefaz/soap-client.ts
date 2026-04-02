/**
 * Cliente SOAP para comunicação com Web Services da SEFAZ
 * Usa mTLS (certificado A1) para autenticação
 */
import https from 'https'

interface SoapRequest {
  url: string
  action: string  // SOAPAction header
  body: string    // XML body (dentro do envelope SOAP)
  privateKeyPem: string
  certificatePem: string
  timeout?: number
}

/**
 * Monta envelope SOAP 1.2 para SEFAZ
 */
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

/**
 * Envia requisição SOAP com mTLS para a SEFAZ
 */
export async function sendSoapRequest(req: SoapRequest): Promise<string> {
  // Namespace varia por serviço
  const xmlns = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4'

  const envelope = wrapSoapEnvelope(req.body, xmlns)

  const urlObj = new URL(req.url)

  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/soap+xml; charset=utf-8',
        'SOAPAction': req.action,
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
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data)
        } else {
          reject(new Error(`SEFAZ HTTP ${res.statusCode}: ${data.substring(0, 500)}`))
        }
      })
    })

    httpReq.on('error', err => reject(new Error(`SEFAZ connection error: ${err.message}`)))
    httpReq.on('timeout', () => { httpReq.destroy(); reject(new Error('SEFAZ timeout (30s)')) })

    httpReq.write(envelope)
    httpReq.end()
  })
}

/**
 * Extrai o conteúdo do body SOAP da resposta
 */
export function extractSoapBody(soapResponse: string): string {
  // Extrair conteúdo entre <soap:Body> ou <soap12:Body>
  const match = soapResponse.match(/<(?:soap12?:)?Body[^>]*>([\s\S]*?)<\/(?:soap12?:)?Body>/i)
  return match?.[1]?.trim() || soapResponse
}
