import type { BoletoProvider, BoletoInput, BoletoResult, BoletoStatus } from './types'
import https from 'https'

/**
 * Banco Itaú — Provider de Boletos via Cash Management API v2
 *
 * Usa mTLS com certificado dinâmico (.crt + .key separados, NÃO .pfx)
 * OAuth2 client_credentials para obter token (TTL: 300s)
 * Suporta boleto puro (Cash Management) e boleto+PIX (BoleCode)
 *
 * Auth: POST https://sts.itau.com.br/as/token.oauth2
 * API:  POST https://secure.api.cloud.itau.com.br/cash_management/v2/bank-slips
 * Docs: https://devportal.itau.com.br/
 *
 * Diferenças vs Inter:
 * - Certificado: .crt + .key separados (não .pfx)
 * - Header extra: x-itau-apikey = client_id
 * - Token URL: /as/token.oauth2 (não /api/oauth/token)
 */

// Production
const ITAU_AUTH_HOST = 'sts.itau.com.br'
const ITAU_API_HOST = 'secure.api.cloud.itau.com.br'

// Sandbox
const ITAU_AUTH_HOST_SANDBOX = 'devportal.itau.com.br'
const ITAU_API_HOST_SANDBOX = 'devportal.itau.com.br'

interface ItauConfig {
  clientId: string
  clientSecret: string
  // Itaú uses .crt + .key separately (NOT .pfx)
  certPem: string    // PEM content of .crt (or base64 encoded)
  keyPem: string     // PEM content of .key (or base64 encoded)
  // Bank account details
  agencia: string
  conta: string
  carteira: string         // default: '109'
  codigoBeneficiario: string
  sandbox?: boolean
}

function decodePem(input: string): string {
  // If it already looks like PEM, return as-is
  if (input.includes('-----BEGIN')) return input
  // Otherwise assume base64-encoded PEM
  return Buffer.from(input, 'base64').toString('utf8')
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

// Token cache (TTL 300s, refresh at 240s)
let tokenCache: { token: string; expiresAt: number } | null = null

export class ItauBoletoProvider implements BoletoProvider {
  name = 'itau'

  private config: ItauConfig

  constructor(config?: ItauConfig) {
    this.config = {
      clientId: config?.clientId || process.env.ITAU_CLIENT_ID || '',
      clientSecret: config?.clientSecret || process.env.ITAU_CLIENT_SECRET || '',
      certPem: config?.certPem || process.env.ITAU_CERT_PEM || '',
      keyPem: config?.keyPem || process.env.ITAU_KEY_PEM || '',
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
    if (!this.config.certPem || !this.config.keyPem) {
      throw new Error('Certificado Itau nao configurado. Va em Configuracoes > Boletos CNAB e insira o certificado (.crt) e chave privada (.key).')
    }
    return {
      cert: decodePem(this.config.certPem),
      key: decodePem(this.config.keyPem),
    }
  }

  private async getAccessToken(): Promise<string> {
    // Check cache (refresh 60s before expiry)
    if (tokenCache && Date.now() < tokenCache.expiresAt - 60000) {
      return tokenCache.token
    }

    if (!this.config.clientId || !this.config.clientSecret) {
      throw new Error('Client ID e Client Secret do Itau nao configurados. Va em Configuracoes > Boletos CNAB.')
    }

    const { cert, key } = this.getTls()
    const bodyStr = [
      `grant_type=client_credentials`,
      `client_id=${encodeURIComponent(this.config.clientId)}`,
      `client_secret=${encodeURIComponent(this.config.clientSecret)}`,
    ].join('&')

    const authPath = this.config.sandbox ? '/api/jwt' : '/as/token.oauth2'

    const result = await httpsRequest({
      hostname: this.authHost,
      port: 443,
      path: authPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
      cert,
      key,
      rejectUnauthorized: !this.config.sandbox,
    }, bodyStr)

    if (result.status !== 200) {
      const errDetail = result.data.substring(0, 300)
      console.error('[Itau OAuth Error]', { status: result.status, body: errDetail })
      throw new Error(`Erro OAuth2 Itau (${result.status}): ${errDetail}`)
    }

    const json = JSON.parse(result.data)
    const expiresIn = json.expires_in || 300

    tokenCache = {
      token: json.access_token,
      expiresAt: Date.now() + expiresIn * 1000,
    }

    return json.access_token
  }

  private async apiRequest(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<{ status: number; json: Record<string, any> }> {
    const token = await this.getAccessToken()
    const { cert, key } = this.getTls()
    const bodyStr = body ? JSON.stringify(body) : undefined

    const apiPath = this.config.sandbox
      ? `/sandboxapi/cash_management_ext${path}`
      : `/cash_management/v2${path}`

    const result = await httpsRequest({
      hostname: this.apiHost,
      port: 443,
      path: apiPath,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-itau-apikey': this.config.clientId,
        ...(bodyStr ? { 'Content-Length': String(Buffer.byteLength(bodyStr)) } : {}),
      },
      cert,
      key,
      rejectUnauthorized: !this.config.sandbox,
    }, bodyStr)

    let json: Record<string, any> = {}
    try { json = JSON.parse(result.data) } catch { /* empty */ }

    if (result.status >= 400) {
      const detail = json.mensagem || json.message || json.title || result.data.substring(0, 300)
      console.error('[Itau API Error]', { status: result.status, path: apiPath, detail })
      throw new Error(`Erro Itau (${result.status}): ${detail}`)
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

    // Nosso numero: up to 8 digits for standard carteiras
    const nossoNumero = (input.receivableId || String(Date.now()))
      .replace(/\D/g, '')
      .substring(0, 8)
      .padStart(8, '0')

    const valorStr = (input.amount / 100).toFixed(2)

    const payload: Record<string, unknown> = {
      etapa_processo_boleto: 'efetivacao',
      beneficiario: {
        id_beneficiario: this.config.codigoBeneficiario,
      },
      dado_boleto: {
        tipo_boleto: 'a vista',
        codigo_carteira: this.config.carteira,
        valor_total_titulo: valorStr,
        codigo_especie: '01', // Duplicata Mercantil
        data_emissao: new Date().toISOString().split('T')[0],
        data_vencimento: dueDate,
        codigo_aceite: 'N',
        pagador: {
          pessoa: {
            nome_pessoa: input.customerName.substring(0, 50),
            tipo_pessoa: isPJ ? 'juridica' : 'fisica',
            ...(isPJ ? { cnpj: doc } : { cpf: doc }),
          },
          endereco: {
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
            texto_seu_numero: input.receivableId?.substring(0, 15) || '',
            valor_titulo: valorStr,
            texto_uso_beneficiario: input.description?.substring(0, 25) || '',
          },
        ],
      },
    }

    const { json } = await this.apiRequest('POST', '/bank-slips', payload)

    // Extract response
    const dados = json.dado_boleto || json
    const individuais = (dados.dados_individuais_boleto || [])[0] || {}

    const resultNossoNumero = individuais.numero_nosso_numero || nossoNumero

    return {
      success: true,
      nossoNumero: resultNossoNumero,
      barcode: individuais.codigo_barras || dados.codigo_barras || '',
      digitableLine: individuais.numero_linha_digitavel || dados.numero_linha_digitavel || '',
      boletoUrl: individuais.url_boleto || undefined,
      pixCode: individuais.pix_copia_e_cola || individuais.texto_pix_copia_cola || undefined,
    }
  }

  async checkStatus(nossoNumero: string): Promise<BoletoStatus> {
    const { json } = await this.apiRequest(
      'GET',
      `/bank-slips?id_beneficiario=${this.config.codigoBeneficiario}&nosso_numero=${nossoNumero}`
    )

    const data = (json.data || [])[0] || json
    const situacao = (data.situacao_boleto || data.codigo_situacao || '').toUpperCase()

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
      paidAmount: data.valor_pago ? Math.round(parseFloat(data.valor_pago) * 100) : undefined,
      paidDate: data.data_pagamento || undefined,
    }
  }

  async cancelBoleto(nossoNumero: string): Promise<void> {
    // Itaú uses PATCH for baixa/cancellation
    await this.apiRequest(
      'PATCH',
      `/bank-slips/${this.config.codigoBeneficiario}/${nossoNumero}/instructions/baixa`,
      { motivo_baixa: 'APEDIDODOCLIENTE' }
    )
  }
}
