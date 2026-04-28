/**
 * Registry de parsers de adquirentes — facilita auto-detect e troca futura.
 * Quando adicionar Cielo/Stone/etc, importa aqui.
 */
import type { AcquirerStatementParser, AcquirerName } from './types'
import { redeParser } from './rede-parser'

export const PARSERS: AcquirerStatementParser[] = [
  redeParser,
]

export function getParser(acquirer: AcquirerName): AcquirerStatementParser | undefined {
  return PARSERS.find(p => p.acquirer === acquirer)
}

export function autoDetect(text: string): AcquirerStatementParser | undefined {
  return PARSERS.find(p => p.matches(text))
}
