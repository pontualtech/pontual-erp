import { prisma } from '@pontual/db'
import type { PaymentProvider } from './types'
import { AsaasProvider } from './adapters/asaas'
import { MockProvider } from './adapters/mock'

/**
 * Factory do payment provider. Pode ser instanciado de 2 formas:
 *
 * 1. Sem accountId → usa o provider global do .env (ASAAS_API_KEY/etc).
 *    Comportamento original, retrocompativel com chamadas antigas.
 *
 * 2. Com accountId → busca a Account no banco, le o provider_config (JSON)
 *    e instancia o provider certo com aquela config especifica. Permite
 *    multiplas contas Asaas simultaneas (ou Inter, ou outros providers no futuro).
 *
 * Schema do provider_config:
 *   {
 *     "provider": "asaas" | "inter" | "mock",
 *     "api_key": "...",          // asaas
 *     "api_url": "...",          // asaas (opcional, default sandbox)
 *     "webhook_token": "..."     // asaas
 *   }
 */
export function getPaymentProvider(): PaymentProvider {
  // Auditoria 24/05: fallback silencioso pra 'mock' em prod era catastrófico
  // (cobrança "ok" mas sem cobrar de verdade). Em prod exige PAYMENT_PROVIDER
  // setado explicitamente; mock continua disponível em dev/test.
  const name = process.env.PAYMENT_PROVIDER
  if (!name) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('PAYMENT_PROVIDER obrigatório em produção (set asaas|inter|mock)')
    }
    return new MockProvider()
  }
  if (name === 'asaas') return new AsaasProvider()
  if (name === 'mock') return new MockProvider()
  // Provider desconhecido configurado: em prod throw, em dev fallback pra mock
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`PAYMENT_PROVIDER inválido em produção: "${name}"`)
  }
  console.warn(`[Payment] Provider "${name}" not found, using mock (dev only)`)
  return new MockProvider()
}

/**
 * Instancia provider a partir da config de uma conta bancaria especifica.
 * Usado quando o atendente escolhe qual conta vai gerar a cobranca.
 * Retorna null se a conta nao existe ou nao tem provider_config valido.
 */
export async function getPaymentProviderForAccount(
  accountId: string,
  companyId: string,
): Promise<PaymentProvider | null> {
  const account = await prisma.account.findFirst({
    where: { id: accountId, company_id: companyId, is_active: true },
    select: { id: true, name: true, provider_config: true },
  })
  if (!account) {
    console.warn(`[Payment] Account ${accountId} not found or inactive`)
    return null
  }
  const cfg = (account.provider_config as Record<string, string>) || {}
  const providerName = String(cfg.provider || '').toLowerCase()

  if (providerName === 'asaas') {
    if (!cfg.api_key) {
      console.warn(`[Payment] Account ${account.name} has provider=asaas but no api_key`)
      return null
    }
    return new AsaasProvider({
      apiKey: cfg.api_key,
      apiUrl: cfg.api_url || undefined,
      webhookToken: cfg.webhook_token || undefined,
    })
  }

  if (providerName === 'mock') return new MockProvider()

  // inter, stripe, outros — ainda nao implementados
  console.warn(`[Payment] Provider "${providerName}" nao suportado ainda (conta ${account.name})`)
  return null
}
