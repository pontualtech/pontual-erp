import type { BoletoProvider } from './types'
import { InterBoletoProvider } from './provider-inter'
import { ItauBoletoProvider } from './provider-itau'
import { StoneBoletoProvider } from './provider-stone'

export type { BoletoProvider, BoletoInput, BoletoResult, BoletoStatus, BoletoRecord } from './types'

const providers: Record<string, () => BoletoProvider> = {
  inter: () => new InterBoletoProvider(),
  itau: () => new ItauBoletoProvider(),
  stone: () => new StoneBoletoProvider(),
}

/**
 * Factory function to get the appropriate boleto provider
 * Provider name should match a setting stored in the Settings table
 * with key 'boleto.provider'
 */
export function getBoletoProvider(providerName: string): BoletoProvider {
  const factory = providers[providerName.toLowerCase()]
  if (!factory) {
    const available = Object.keys(providers).join(', ')
    throw new Error(
      `Provedor de boleto "${providerName}" nao encontrado. Disponiveis: ${available}`
    )
  }
  return factory()
}

/** List all available provider names */
export function listBoletoProviders(): string[] {
  return Object.keys(providers)
}
