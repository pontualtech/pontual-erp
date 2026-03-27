import type { BoletoProvider, BoletoInput, BoletoResult, BoletoStatus } from './types'

/**
 * Itau adapter (placeholder)
 *
 * Requirements:
 * - ITAU_CLIENT_ID: OAuth2 client ID
 * - ITAU_CLIENT_SECRET: OAuth2 client secret
 * - ITAU_CERT_PATH: path to digital certificate (.pfx)
 * - ITAU_CERT_PASSWORD: certificate password
 *
 * Itau API docs: https://developer.itau.com.br/
 * Uses OAuth2 + digital certificate (A1/A3)
 * Production base URL: https://sts.itau.com.br (auth) / https://secure.api.itau (API)
 */

export class ItauBoletoProvider implements BoletoProvider {
  name = 'itau'

  async generateBoleto(_input: BoletoInput): Promise<BoletoResult> {
    // TODO: Implement Itau boleto generation
    // 1. OAuth2 token: POST https://sts.itau.com.br/api/oauth/token
    //    - grant_type=client_credentials, scope=readonly
    //    - Requires digital certificate A1 in TLS handshake
    // 2. Register boleto: POST /itau-ep9-gtw-pix-recebimentos-conciliacoes-v2-ext/v2/boletos_pix
    //    or POST /itau-ep9-gtw-boletos-v2-ext/v2/boletos
    // 3. Itau supports hybrid boleto+PIX (boleto com QR code PIX)

    throw new Error(
      'Itau adapter not implemented. ' +
      'Requires OAuth2 client credentials and digital certificate (A1). ' +
      'Contact Itau for API access at developer.itau.com.br'
    )
  }

  async checkStatus(_nossoNumero: string): Promise<BoletoStatus> {
    // TODO: GET /itau-ep9-gtw-boletos-v2-ext/v2/boletos/{nossoNumero}
    throw new Error('Itau status check not implemented')
  }

  async cancelBoleto(_nossoNumero: string): Promise<void> {
    // TODO: PATCH /itau-ep9-gtw-boletos-v2-ext/v2/boletos/{nossoNumero}/baixa
    throw new Error('Itau boleto cancellation not implemented')
  }
}
