import type { BoletoProvider, BoletoInput, BoletoResult, BoletoStatus } from './types'

/**
 * Stone adapter (placeholder)
 *
 * Requirements:
 * - STONE_CLIENT_ID: OAuth2 client ID
 * - STONE_PRIVATE_KEY: RSA private key for JWT signing
 * - STONE_ACCOUNT_ID: Stone account ID
 *
 * Stone API docs: https://docs.openbank.stone.com.br/
 * Uses OAuth2 with JWT bearer assertion (RS256 signed)
 * Production base URL: https://api.openbank.stone.com.br
 */

export class StoneBoletoProvider implements BoletoProvider {
  name = 'stone'

  async generateBoleto(_input: BoletoInput): Promise<BoletoResult> {
    // TODO: Implement Stone boleto generation
    // 1. Create JWT assertion signed with RSA private key
    // 2. Exchange for access token: POST https://login.openbank.stone.com.br/auth/realms/stone_bank/protocol/openid-connect/token
    //    - grant_type=client_credentials, client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer
    // 3. Register boleto: POST /api/v1/barcode_payment_invoices
    //    Body: { account_id, amount, expiration_date, customer: { document, name } }
    // 4. Stone automatically generates PIX QR code for hybrid boleto

    throw new Error(
      'Stone adapter not implemented. ' +
      'Requires OAuth2 with JWT bearer assertion (RS256). ' +
      'Contact Stone for API access at docs.openbank.stone.com.br'
    )
  }

  async checkStatus(_nossoNumero: string): Promise<BoletoStatus> {
    // TODO: GET /api/v1/barcode_payment_invoices/{id}
    throw new Error('Stone status check not implemented')
  }

  async cancelBoleto(_nossoNumero: string): Promise<void> {
    // TODO: DELETE /api/v1/barcode_payment_invoices/{id}
    throw new Error('Stone boleto cancellation not implemented')
  }
}
