import type { BoletoProvider, BoletoInput, BoletoResult, BoletoStatus } from './types'

/**
 * Banco Inter adapter (API v2)
 *
 * Requirements:
 * - INTER_CLIENT_ID: OAuth2 client ID
 * - INTER_CLIENT_SECRET: OAuth2 client secret
 * - INTER_CERT_PATH: path to mTLS certificate (.pfx or .pem)
 * - INTER_CERT_KEY_PATH: path to mTLS private key (.key)
 *
 * Inter API docs: https://developers.inter.co/
 * Production base URL: https://cdpj.partners.bancointer.com.br
 */

const INTER_API_BASE = 'https://cdpj.partners.bancointer.com.br'

function isDev() {
  return process.env.NODE_ENV !== 'production'
}

function generateMockNossoNumero(): string {
  const timestamp = Date.now().toString().slice(-8)
  const random = Math.floor(Math.random() * 100).toString().padStart(2, '0')
  return `${timestamp}${random}`
}

function generateMockBarcode(): string {
  // 44-digit barcode for Banco Inter (bank code 077)
  const digits = '07790001' + Date.now().toString().slice(-28).padStart(28, '0') + '00000000'
  return digits.slice(0, 44)
}

function generateMockDigitableLine(barcode: string): string {
  // Simplified digitavel line format
  const p1 = barcode.slice(0, 5) + '.' + barcode.slice(5, 10)
  const p2 = barcode.slice(10, 15) + '.' + barcode.slice(15, 21)
  const p3 = barcode.slice(21, 26) + '.' + barcode.slice(26, 32)
  const p4 = barcode.slice(32, 33)
  const p5 = barcode.slice(33, 44)
  return `${p1} ${p2} ${p3} ${p4} ${p5}`
}

export class InterBoletoProvider implements BoletoProvider {
  name = 'inter'

  private clientId: string
  private clientSecret: string
  private certPath: string
  private certKeyPath: string

  constructor() {
    this.clientId = process.env.INTER_CLIENT_ID || ''
    this.clientSecret = process.env.INTER_CLIENT_SECRET || ''
    this.certPath = process.env.INTER_CERT_PATH || ''
    this.certKeyPath = process.env.INTER_CERT_KEY_PATH || ''
  }

  /**
   * Get OAuth2 access token using client credentials
   * Inter requires mTLS (mutual TLS) for all API calls
   */
  private async getAccessToken(): Promise<string> {
    // TODO: Implement real OAuth2 token exchange with mTLS
    // POST https://cdpj.partners.bancointer.com.br/oauth/v2/token
    // Content-Type: application/x-www-form-urlencoded
    // Body: client_id=...&client_secret=...&scope=boleto-cobranca.read boleto-cobranca.write&grant_type=client_credentials
    // Must include client certificate in TLS handshake (Node.js https.Agent with cert/key)
    throw new Error('OAuth2 token exchange not implemented - requires mTLS certificate')
  }

  async generateBoleto(input: BoletoInput): Promise<BoletoResult> {
    // Development mode: return mock data
    if (isDev()) {
      const nossoNumero = generateMockNossoNumero()
      const barcode = generateMockBarcode()
      return {
        success: true,
        nossoNumero,
        barcode,
        digitableLine: generateMockDigitableLine(barcode),
        boletoUrl: `https://cdpj.partners.bancointer.com.br/boletos/${nossoNumero}/pdf`,
        pixCode: `00020126580014br.gov.bcb.pix0136mock-${nossoNumero}@inter.co5204000053039865802BR5925${input.customerName.slice(0, 25)}6009SAO PAULO62070503***6304MOCK`,
      }
    }

    // TODO: Real implementation
    // 1. Get access token via getAccessToken()
    // 2. POST /cobranca/v3/cobrancas
    //    Headers: Authorization: Bearer {token}
    //    Body:
    //    {
    //      "seuNumero": input.receivableId,
    //      "valorNominal": input.amount / 100, // API expects reais, not centavos
    //      "dataVencimento": input.dueDate,
    //      "numDiasAgenda": 60,
    //      "pagador": {
    //        "cpfCnpj": input.customerDocument,
    //        "nome": input.customerName,
    //        "tipoPessoa": input.customerDocument.length > 11 ? "JURIDICA" : "FISICA"
    //      },
    //      "mensagem": { "linha1": input.description }
    //    }
    // 3. Response includes codigoCobranca (nossoNumero), codigoBarras, linhaDigitavel
    // 4. To get PDF: GET /cobranca/v3/cobrancas/{codigoCobranca}/pdf
    // 5. PIX: included in response if enabled in Inter banking panel

    throw new Error('Inter boleto generation not implemented - requires mTLS certificate configuration')
  }

  async checkStatus(nossoNumero: string): Promise<BoletoStatus> {
    // Development mode: return mock data
    if (isDev()) {
      return {
        nossoNumero,
        status: 'REGISTERED',
        paidAmount: undefined,
        paidDate: undefined,
      }
    }

    // TODO: Real implementation
    // GET /cobranca/v3/cobrancas/{nossoNumero}
    // Response situacao: EMITIDA, PAGA, VENCIDA, CANCELADA, EXPIRADA
    // Map to our status: EMITIDA->REGISTERED, PAGA->PAID, VENCIDA->OVERDUE, CANCELADA/EXPIRADA->CANCELLED

    throw new Error('Inter status check not implemented - requires mTLS certificate configuration')
  }

  async cancelBoleto(nossoNumero: string): Promise<void> {
    // Development mode: no-op
    if (isDev()) {
      console.log(`[INTER DEV] Boleto ${nossoNumero} cancelado (mock)`)
      return
    }

    // TODO: Real implementation
    // POST /cobranca/v3/cobrancas/{nossoNumero}/cancelar
    // Body: { "motivoCancelamento": "APEDIDODOCLIENTE" }
    // motivos: APEDIDODOCLIENTE, SUBSTITUICAO, PAGODIRETOAOCLIENTE, OUTROS

    throw new Error('Inter boleto cancellation not implemented - requires mTLS certificate configuration')
  }
}
