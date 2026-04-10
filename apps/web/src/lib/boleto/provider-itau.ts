import type { BoletoProvider, BoletoInput, BoletoResult, BoletoStatus } from './types'
import https from 'https'
import forge from 'node-forge'

/**
 * Banco Itaú — Provider de Boletos via API v2
 *
 * Usa mTLS com certificado A1 (mesmo padrão do Inter)
 * OAuth2 client_credentials para obter token
 * Suporta boleto puro e boleto híbrido (com PIX QR Code)
 *
 * Auth: https://sts.itau.com.br/api/oauth/token
 * API:  https://secure.api.itau/itau-ep9-gtw-boletos-v2-ext/v2/boletos
 * Docs: https://developer.itau.com.br/
 */

// Production endpoints
const ITAU_AUTH_HOST = 'sts.itau.com.br'
const ITAU_API_HOST = 'secure.api.itau'

// Sandbox endpoints
const ITAU_AUTH_HOST_SANDBOX = 'sts.sandbox.itau.com.br'
const ITAU_API_HOST_SANDBOX = 'sandbox.api.itau'

interface ItauConfig {
  clientId: string
  clientSecret: string
  pfxBase64: string
  pfxPassword: string
  agencia: string
  conta: string
  carteira: string         // default: '109'
  codigoBeneficiario: string
  sandbox?: boolean
}

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
    req.setTimeout(15000, () => { req.destroy(new Error('Itau API timeout (15s)')); })
    if (body) req.write(body)
    req.end()
  })
}

export class ItauBoletoProvider implements BoletoProvider {
  name = 'itau'

  private config: ItauConfig

  constructor(config?: ItauConfig) {
    this.config = {
      clientId: config?.clientId || process.env.ITAU_CLIENT_ID || '',
      clientSecret: config?.clientSecret || process.env.ITAU_CLIENT_SECRET || '',
      pfxBase64: config?.pfxBase64 || '',
      pfxPassword: config?.pfxPassword || '',
      agencia: config?.agencia || '0001',
      conta: config?.conta || '',
      carteira: config?.carteira || '109',
      codigoBeneficiario: config?.codigoBeneficiario || '',
      sandbox: config?.sandbox ?? (process.env.ITAU_SANDBOX === 'true'),
    }
  }

  private get authHost() { return this.config.sandbox ? ITAU_AUTH_HOST_SANDBOX : ITAU_AUTH_HOST }
  private get apiHost() { return this.config.sandbox ? ITAU_API_HOST_SANDBOX : ITAU_API_HOST }

  private getTls() {
    if (!this.config.pfxBase64) throw new Error('Certificado A1 nao configurado para o Itau. Va em Configuracoes > Boletos CNAB.')
    return extractPem(this.config.pfxBase64, this.config.pfxPassword)
  }

  private async getAccessToken(): Promise<string> {
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new Error('Client ID e Client Secret do Itau nao configurados. Va em Configuracoes > Boletos CNAB.')
    }

    const { keyPem, certPem } = this.getTls()
    const bodyStr = [
      `grant_type=client_credentials`,
      `client_id=${encodeURIComponent(this.config.clientId)}`,
      `client_secret=${encodeURIComponent(this.config.clientSecret)}`,
    ].join('&')

    const result = await httpsRequest({
      hostname: this.authHost,
      port: 443,
      path: '/api/oauth/token',
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
      const errDetail = result.data.substring(0, 200)
      console.error('[Itau OAuth Error]', { status: result.status, body: errDetail })
      throw new Error(`Erro OAuth2 Itau (${result.status}): ${errDetail}`)
    }

    const json = JSON.parse(result.data)
    return json.access_token
  }

  private async apiRequest(method: string, path: string, body?: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
    const token = await this.getAccessToken()
    const { keyPem, certPem } = this.getTls()
    const bodyStr = body ? JSON.stringify(body) : undefined

    const result = await httpsRequest({
      hostname: this.apiHost,
      port: 443,
      path,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': String(Buffer.byteLength(bodyStr)) } : {}),
      },
      key: keyPem,
      cert: certPem,
      rejectUnauthorized: true,
    }, bodyStr)

    let json: Record<string, unknown> = {}
    try { json = JSON.parse(result.data) } catch { /* empty response is ok for some endpoints */ }

    if (result.status >= 400) {
      const detail = (json as any).mensagem || (json as any).message || result.data.substring(0, 200)
      console.error('[Itau API Error]', { status: result.status, path, detail })
      throw new Error(`Erro Itau API (${result.status}): ${detail}`)
    }

    return { status: result.status, json }
  }

  async generateBoleto(input: BoletoInput): Promise<BoletoResult> {
    // Ensure dueDate is not in the past
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStr = tomorrow.toISOString().split('T')[0]
    const dueDate = input.dueDate < tomorrowStr ? tomorrowStr : input.dueDate

    // Format document (remove non-digits)
    const doc = input.customerDocument.replace(/\D/g, '')
    const isPJ = doc.length > 11

    // Itaú requires the nosso_numero to be generated by the beneficiary
    // Format: up to 8 digits for carteira 109
    const nossoNumero = (input.receivableId || String(Date.now()))
      .replace(/\D/g, '')
      .substring(0, 8)
      .padStart(8, '0')

    const payload: Record<string, unknown> = {
      etapa_processo_boleto: 'efetivacao',
      beneficiario: {
        id_beneficiario: this.config.codigoBeneficiario,
      },
      dado_boleto: {
        tipo_boleto: 'a vista',
        codigo_carteira: this.config.carteira,
        valor_total_titulo: (input.amount / 100).toFixed(2),
        codigo_especie: '01', // Duplicata Mercantil
        data_emissao: new Date().toISOString().split('T')[0],
        data_vencimento: dueDate,
        codigo_aceite: 'N',
        pagador: {
          pessoa: {
            nome_pessoa: input.customerName.substring(0, 50),
            tipo_pessoa: isPJ ? 'J' : 'F',
            [isPJ ? 'cnpj' : 'cpf']: doc,
          },
          endereco: {
            // Itaú requires address — use placeholder if not available
            nome_logradouro: 'Nao informado',
            nome_bairro: 'Nao informado',
            nome_cidade: 'Sao Paulo',
            sigla_UF: 'SP',
            numero_CEP: '01000000',
          },
        },
        dados_individuais_boleto: [
          {
            numero_nosso_numero: nossoNumero,
            data_vencimento: dueDate,
            valor_titulo: (input.amount / 100).toFixed(2),
            texto_uso_beneficiario: input.description?.substring(0, 25) || '',
          },
        ],
      },
    }

    const { json } = await this.apiRequest(
      'POST',
      '/itau-ep9-gtw-boletos-v2-ext/v2/boletos',
      payload
    )

    // Extract response data
    const dados = json.dado_boleto as Record<string, unknown> || json
    const individuais = ((dados.dados_individuais_boleto || []) as Record<string, unknown>[])[0] || {}

    return {
      success: true,
      nossoNumero: (individuais.numero_nosso_numero as string) || nossoNumero,
      barcode: (individuais.codigo_barras as string) || (dados.codigo_barras as string) || '',
      digitableLine: (individuais.numero_linha_digitavel as string) || (dados.linha_digitavel as string) || '',
      boletoUrl: (individuais.url_boleto as string) || undefined,
      pixCode: (individuais.texto_pix_copia_cola as string) || undefined,
    }
  }

  async checkStatus(nossoNumero: string): Promise<BoletoStatus> {
    const { json } = await this.apiRequest(
      'GET',
      `/itau-ep9-gtw-boletos-v2-ext/v2/boletos?id_beneficiario=${this.config.codigoBeneficiario}&numero_nosso_numero=${nossoNumero}`
    )

    const data = ((json.data || []) as Record<string, unknown>[])[0] || json
    const situacao = (data.situacao_boleto as string || data.codigo_situacao as string || '').toUpperCase()

    const statusMap: Record<string, BoletoStatus['status']> = {
      EMITIDO: 'REGISTERED',
      REGISTRADO: 'REGISTERED',
      LIQUIDADO: 'PAID',
      PAGO: 'PAID',
      VENCIDO: 'OVERDUE',
      BAIXADO: 'CANCELLED',
      CANCELADO: 'CANCELLED',
    }

    return {
      nossoNumero,
      status: statusMap[situacao] || 'REGISTERED',
      paidAmount: data.valor_pago ? Math.round(parseFloat(data.valor_pago as string) * 100) : undefined,
      paidDate: (data.data_pagamento as string) || undefined,
    }
  }

  async cancelBoleto(nossoNumero: string): Promise<void> {
    await this.apiRequest(
      'PATCH',
      `/itau-ep9-gtw-boletos-v2-ext/v2/boletos/${this.config.codigoBeneficiario}/${nossoNumero}/baixa`,
      {}
    )
  }
}
