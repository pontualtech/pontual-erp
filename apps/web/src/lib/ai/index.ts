/**
 * AI module — Chatwoot + AI bot integration
 *
 * This module provides:
 * - Intent detection (AI or keyword-based)
 * - Action handlers for each intent
 * - Chatwoot bot API communication
 * - Multi-turn conversation state management
 */

export { detectIntent, type DetectedIntent, type IntentAction, type AIProvider, type CustomerContext } from './detect-intent'
export { sendChatwootMessage, transferToHuman, isBotConfigured } from './chatwoot-api'
export { getState, setState, clearState, hasActiveState, type ConversationState, type ConversationStep } from './conversation-state'
export {
  findCustomerByPhone,
  buildCustomerContext,
  handleConsultaOS,
  handleNovoOrcamento,
  handleAgendarColeta,
  handleStatusPagamento,
  handleTransferHuman,
  handleGeneralQuestion,
} from './handlers'
