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

export interface ItauConfig {
  clientId: string
  clientSecret: string
  certPem: string      // .crt content (PEM or base64)
  keyPem: string       // .key content (PEM or base64)
  agencia: string
  conta: string
  carteira: string
  codigoBeneficiario: string
  sandbox?: boolean
}

export interface StoneConfig {
  apiKey: string
  accountId: string
}

/**
 * Factory function to get the appropriate boleto provider
 */
export function getBoletoProvider(providerName: string, config?: InterConfig | ItauConfig | StoneConfig): BoletoProvider {
  switch (providerName.toLowerCase()) {
    case 'inter':
      return new InterBoletoProvider(config as InterConfig)
    case 'itau':
      return new ItauBoletoProvider(config as ItauConfig)
    case 'stone':
      return new StoneBoletoProvider(config as StoneConfig)
    default:
      throw new Error(`Provedor de boleto "${providerName}" nao encontrado. Disponiveis: inter, itau, stone`)
  }
}

/** List all available provider names */
export function listBoletoProviders(): string[] {
  return ['inter', 'itau', 'stone']
}
