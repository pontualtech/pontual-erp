import type { BoletoProvider, BoletoInput, BoletoResult, BoletoStatus } from './types'
import https from 'https'

/**
 * Stone — Provider de Boletos via API
 *
 * Auth: API Key (header Authorization: Bearer sk_...)
 * Docs: https://docs.openbank.stone.com.br/
 * Gera boleto híbrido (boleto + PIX automaticamente)
 */

const STONE_API_HOST = 'api.openbank.stone.com.br'

function httpsRequest(options: https.RequestOptions, body?: string): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode || 0, data: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

export class StoneBoletoProvider implements BoletoProvider {
  name = 'stone'

  private apiKey: string
  private accountId: string

  constructor(config?: { apiKey: string; accountId: string }) {
    this.apiKey = config?.apiKey || process.env.STONE_API_KEY || ''
    this.accountId = config?.accountId || process.env.STONE_ACCOUNT_ID || ''
  }

  async generateBoleto(input: BoletoInput): Promise<BoletoResult> {
    if (!this.apiKey) throw new Error('API Key da Stone nao configurada')

    const payload = JSON.stringify({
      account_id: this.accountId || undefined,
      amount: input.amount, // centavos
      expiration_date: input.dueDate,
      customer: {
        document: input.customerDocument.replace(/[.\-\/]/g, ''),
        name: input.customerName.substring(0, 50),
      },
      invoice_type: 'deposit',
    })

    const result = await httpsRequest({
      hostname: STONE_API_HOST,
      port: 443,
      path: '/api/v1/barcode_payment_invoices',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, payload)

    if (result.status !== 200 && result.status !== 201) {
      throw new Error(`Erro Stone (${result.status}): ${result.data.substring(0, 300)}`)
    }

    const json = JSON.parse(result.data)

    return {
      success: true,
      nossoNumero: json.id || '',
      barcode: json.barcode || '',
      digitableLine: json.writable_line || json.digitable_line || '',
      boletoUrl: json.url || undefined,
      pixCode: json.pix_qr_code || json.br_code || undefined,
    }
  }

  async checkStatus(nossoNumero: string): Promise<BoletoStatus> {
    if (!this.apiKey) throw new Error('API Key da Stone nao configurada')

    const result = await httpsRequest({
      hostname: STONE_API_HOST,
      port: 443,
      path: `/api/v1/barcode_payment_invoices/${nossoNumero}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
    })

    if (result.status !== 200) throw new Error(`Erro Stone (${result.status})`)

    const json = JSON.parse(result.data)
    const statusMap: Record<string, BoletoStatus['status']> = {
      created: 'REGISTERED',
      active: 'REGISTERED',
      paid: 'PAID',
      expired: 'CANCELLED',
      cancelled: 'CANCELLED',
    }

    return {
      nossoNumero,
      status: statusMap[json.status] || 'REGISTERED',
      paidAmount: json.paid_amount || undefined,
      paidDate: json.paid_at || undefined,
    }
  }

  async cancelBoleto(nossoNumero: string): Promise<void> {
    if (!this.apiKey) throw new Error('API Key da Stone nao configurada')

    const result = await httpsRequest({
      hostname: STONE_API_HOST,
      port: 443,
      path: `/api/v1/barcode_payment_invoices/${nossoNumero}`,
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
    })

    if (result.status !== 200 && result.status !== 204) {
      throw new Error(`Erro ao cancelar Stone (${result.status}): ${result.data.substring(0, 200)}`)
    }
  }
}
