import type { BoletoProvider, BoletoInput, BoletoResult, BoletoStatus } from './types'
import https from 'https'
import forge from 'node-forge'
import { prisma } from '@pontual/db'

/**
 * Banco Inter — Provider de Boletos via API v3
 *
 * Usa mTLS com certificado A1 (mesmo do NFS-e)
 * OAuth2 client_credentials para obter token
 * API: https://cdpj.partners.bancointer.com.br
 */

const INTER_API_HOST = 'cdpj.partners.bancointer.com.br'

function extractPem(pfxBase64: string, password: string): { keyPem: string; certPem: string } {
  const pfxDer = forge.util.decode64(pfxBase64)
  const pfxAsn1 = forge.asn1.fromDer(pfxDer)
  const p12 = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, password)
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })
  return {
    keyPem: forge.pki.privateKeyToPem(keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]![0].key!),
    certPem: forge.pki.certificateToPem(certBags[forge.pki.oids.certBag]![0].cert!),
  }
}

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

export class InterBoletoProvider implements BoletoProvider {
  name = 'inter'

  private clientId: string
  private clientSecret: string
  private pfxBase64: string
  private pfxPassword: string

  constructor(config?: { clientId: string; clientSecret: string; pfxBase64: string; pfxPassword: string }) {
    this.clientId = config?.clientId || process.env.INTER_CLIENT_ID || ''
    this.clientSecret = config?.clientSecret || process.env.INTER_CLIENT_SECRET || ''
    this.pfxBase64 = config?.pfxBase64 || ''
    this.pfxPassword = config?.pfxPassword || ''
  }

  private getTls() {
    if (!this.pfxBase64) throw new Error('Certificado A1 não configurado para o Banco Inter')
    return extractPem(this.pfxBase64, this.pfxPassword)
  }

  private async getAccessToken(): Promise<string> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('INTER_CLIENT_ID e INTER_CLIENT_SECRET não configurados. Vá em Configurações > Boletos CNAB e preencha.')
    }

    const { keyPem, certPem } = this.getTls()
    const bodyStr = `client_id=${encodeURIComponent(this.clientId)}&client_secret=${encodeURIComponent(this.clientSecret)}&scope=boleto-cobranca.read boleto-cobranca.write&grant_type=client_credentials`

    const result = await httpsRequest({
      hostname: INTER_API_HOST,
      port: 443,
      path: '/oauth/v2/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
      key: keyPem,
      cert: certPem,
      rejectUnauthorized: true,
    }, bodyStr)

    if (result.status !== 200) {
      throw new Error(`Erro OAuth2 Inter (${result.status}): ${result.data.substring(0, 200)}`)
    }

    const json = JSON.parse(result.data)
    return json.access_token
  }

  async generateBoleto(input: BoletoInput): Promise<BoletoResult> {
    const token = await this.getAccessToken()
    const { keyPem, certPem } = this.getTls()

    const payload = JSON.stringify({
      seuNumero: input.receivableId?.substring(0, 15) || String(Date.now()),
      valorNominal: (input.amount / 100).toFixed(2),
      dataVencimento: input.dueDate,
      numDiasAgenda: 60,
      pagador: {
        cpfCnpj: input.customerDocument.replace(/[.\-\/]/g, ''),
        nome: input.customerName.substring(0, 50),
        tipoPessoa: input.customerDocument.replace(/\D/g, '').length > 11 ? 'JURIDICA' : 'FISICA',
      },
      mensagem: {
        linha1: input.description?.substring(0, 78) || 'Cobranca',
      },
    })

    const result = await httpsRequest({
      hostname: INTER_API_HOST,
      port: 443,
      path: '/cobranca/v3/cobrancas',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      key: keyPem,
      cert: certPem,
      rejectUnauthorized: true,
    }, payload)

    if (result.status !== 200 && result.status !== 201) {
      const err = result.data.substring(0, 300)
      throw new Error(`Erro ao gerar boleto Inter (${result.status}): ${err}`)
    }

    const json = JSON.parse(result.data)

    return {
      success: true,
      nossoNumero: json.codigoCobranca || json.nossoNumero || '',
      barcode: json.codigoBarras || '',
      digitableLine: json.linhaDigitavel || '',
      boletoUrl: json.codigoCobranca ? `https://cdpj.partners.bancointer.com.br/cobranca/v3/cobrancas/${json.codigoCobranca}/pdf` : undefined,
      pixCode: json.pix?.txid ? json.pix.pixCopiaECola || '' : undefined,
    }
  }

  async checkStatus(nossoNumero: string): Promise<BoletoStatus> {
    const token = await this.getAccessToken()
    const { keyPem, certPem } = this.getTls()

    const result = await httpsRequest({
      hostname: INTER_API_HOST,
      port: 443,
      path: `/cobranca/v3/cobrancas/${nossoNumero}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
      key: keyPem,
      cert: certPem,
      rejectUnauthorized: true,
    })

    if (result.status !== 200) {
      throw new Error(`Erro ao consultar boleto Inter (${result.status})`)
    }

    const json = JSON.parse(result.data)
    const statusMap: Record<string, BoletoStatus['status']> = {
      EMITIDA: 'REGISTERED',
      PAGA: 'PAID',
      VENCIDA: 'OVERDUE',
      CANCELADA: 'CANCELLED',
      EXPIRADA: 'CANCELLED',
    }

    return {
      nossoNumero,
      status: statusMap[json.situacao] || 'REGISTERED',
      paidAmount: json.valorTotalRecebimento ? Math.round(parseFloat(json.valorTotalRecebimento) * 100) : undefined,
      paidDate: json.dataPagamento || undefined,
    }
  }

  async cancelBoleto(nossoNumero: string): Promise<void> {
    const token = await this.getAccessToken()
    const { keyPem, certPem } = this.getTls()

    const payload = JSON.stringify({ motivoCancelamento: 'APEDIDODOCLIENTE' })

    const result = await httpsRequest({
      hostname: INTER_API_HOST,
      port: 443,
      path: `/cobranca/v3/cobrancas/${nossoNumero}/cancelar`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      key: keyPem,
      cert: certPem,
      rejectUnauthorized: true,
    }, payload)

    if (result.status !== 200 && result.status !== 204) {
      throw new Error(`Erro ao cancelar boleto Inter (${result.status}): ${result.data.substring(0, 200)}`)
    }
  }
}
