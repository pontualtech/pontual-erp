import type { PaymentProvider } from './types'
import { AsaasProvider } from './adapters/asaas'
import { MockProvider } from './adapters/mock'

const providers: Record<string, () => PaymentProvider> = {
  asaas: () => new AsaasProvider(),
  mock: () => new MockProvider(),
}

export function getPaymentProvider(): PaymentProvider {
  const name = process.env.PAYMENT_PROVIDER || 'mock'
  const factory = providers[name]

  if (!factory) {
    console.warn(`[Payment] Provider "${name}" not found, using mock`)
    return new MockProvider()
  }

  return factory()
}
