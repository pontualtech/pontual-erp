import type { BoletoProvider } from './types'
import { InterBoletoProvider } from './provider-inter'
import { ItauBoletoProvider } from './provider-itau'
import { StoneBoletoProvider } from './provider-stone'

export type { BoletoProvider, BoletoInput, BoletoResult, BoletoStatus, BoletoRecord } from './types'

export interface InterConfig {
  clientId: string
  clientSecret: string
  pfxBase64: string
  pfxPassword: string
}

/**
 * Factory function to get the appropriate boleto provider
 */
export function getBoletoProvider(providerName: string, config?: InterConfig): BoletoProvider {
  switch (providerName.toLowerCase()) {
    case 'inter':
      return new InterBoletoProvider(config)
    case 'itau':
      return new ItauBoletoProvider()
    case 'stone':
      return new StoneBoletoProvider()
    default:
      throw new Error(`Provedor de boleto "${providerName}" nao encontrado. Disponiveis: inter, itau, stone`)
  }
}

/** List all available provider names */
export function listBoletoProviders(): string[] {
  return ['inter', 'itau', 'stone']
}
