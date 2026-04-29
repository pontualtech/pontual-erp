/**
 * Cliente Sonax Click2Call API
 *
 * Endpoint: https://click2call.sonax.net.br/sonax-click2call.php
 * Doc: Sonax KB - "Como usar nossa API de click2call dentro do CRM externo"
 *
 * Fluxo:
 * 1. ERP chama esta função
 * 2. Sonax disca o RAMAL do agente (Linphone toca)
 * 3. Quando agente atende, Sonax disca o número externo
 * 4. Conecta os dois (ponte de áudio)
 *
 * Token gerado no portal Sonax pabxcloud.sonax.net.br por cliente.
 * Configurar via env: SONAX_API_TOKEN
 */

const SONAX_CLICK2CALL_URL = 'https://click2call.sonax.net.br/sonax-click2call.php'

export interface Click2CallParams {
  /** DDD + número de destino, somente dígitos. Ex: "12997361519" */
  numero: string
  /** Ramal SIP do agente que vai falar. Ex: "101" */
  ramal: string
}

export interface Click2CallResponse {
  ok: boolean
  data?: unknown
  error?: string
  /** HTTP status retornado pelo endpoint Sonax (debug) */
  httpStatus?: number
}

/**
 * Dispara uma chamada via Click2Call Sonax.
 *
 * Sanitiza o número (só dígitos) e valida tamanho mínimo (8 dígitos).
 * Não loga o token. Timeout 10s.
 */
export async function sonaxClick2Call(params: Click2CallParams): Promise<Click2CallResponse> {
  const token = process.env.SONAX_API_TOKEN
  if (!token || token.length < 10) {
    return { ok: false, error: 'SONAX_API_TOKEN não configurado no servidor' }
  }

  const numero = String(params.numero || '').replace(/\D/g, '')
  if (!numero || numero.length < 8) {
    return { ok: false, error: 'Número de destino inválido (mínimo 8 dígitos)' }
  }

  const ramal = String(params.ramal || '').replace(/\D/g, '')
  if (!ramal || ramal.length < 3) {
    return { ok: false, error: 'Ramal SIP inválido' }
  }

  const url = new URL(SONAX_CLICK2CALL_URL)
  url.searchParams.set('numero', numero)
  url.searchParams.set('ramal', ramal)
  url.searchParams.set('token', token)
  url.searchParams.set('resposta', 'json')

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'application/json' },
    })

    const text = await res.text()
    let data: unknown = text
    try {
      data = JSON.parse(text)
    } catch {
      // resposta não-JSON (Sonax às vezes retorna text/html em erro)
    }

    if (!res.ok) {
      return {
        ok: false,
        error: `Sonax API retornou HTTP ${res.status}`,
        httpStatus: res.status,
        data,
      }
    }

    return { ok: true, data, httpStatus: res.status }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'erro desconhecido na chamada Sonax'
    return { ok: false, error: msg }
  }
}
