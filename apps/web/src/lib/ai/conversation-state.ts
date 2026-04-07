/**
 * In-memory conversation state for multi-turn bot flows.
 *
 * Tracks where we are in a multi-step interaction so the bot
 * can continue a flow across messages (e.g., asking for model, then confirming).
 *
 * Keyed by Chatwoot conversation ID.
 * Entries auto-expire after EXPIRY_MS to prevent stale state.
 */

export type ConversationStep =
  | 'IDLE'
  | 'AWAITING_EQUIPMENT_TYPE'
  | 'AWAITING_EQUIPMENT_BRAND'
  | 'AWAITING_EQUIPMENT_MODEL'
  | 'AWAITING_ISSUE_DESCRIPTION'
  | 'AWAITING_CONFIRMATION'
  | 'AWAITING_PICKUP_ADDRESS'
  | 'AWAITING_PICKUP_DATE'
  | 'AWAITING_PICKUP_CONFIRMATION'

export interface ConversationState {
  step: ConversationStep
  action: string
  data: Record<string, any>
  customerId?: string
  customerName?: string
  updatedAt: number
}

const EXPIRY_MS = 24 * 60 * 60 * 1000 // 24 hours (was 30 min — too short for follow-ups)

const store = new Map<number, ConversationState>()

/**
 * Get current conversation state, or null if expired/missing.
 */
export function getState(conversationId: number): ConversationState | null {
  const state = store.get(conversationId)
  if (!state) return null

  // Auto-expire stale state
  if (Date.now() - state.updatedAt > EXPIRY_MS) {
    store.delete(conversationId)
    return null
  }

  return state
}

/**
 * Update conversation state. Merges with existing data.
 */
export function setState(
  conversationId: number,
  update: Partial<Omit<ConversationState, 'updatedAt'>>
): ConversationState {
  const existing = getState(conversationId)
  const newState: ConversationState = {
    step: update.step ?? existing?.step ?? 'IDLE',
    action: update.action ?? existing?.action ?? '',
    data: { ...existing?.data, ...update.data },
    customerId: update.customerId ?? existing?.customerId,
    customerName: update.customerName ?? existing?.customerName,
    updatedAt: Date.now(),
  }
  store.set(conversationId, newState)
  return newState
}

/**
 * Clear conversation state (reset to idle).
 */
export function clearState(conversationId: number): void {
  store.delete(conversationId)
}

/**
 * Check if conversation has active state.
 */
export function hasActiveState(conversationId: number): boolean {
  const state = getState(conversationId)
  return state !== null && state.step !== 'IDLE'
}

/**
 * Garbage-collect expired entries. Call periodically if needed.
 */
export function cleanupExpired(): number {
  const now = Date.now()
  let cleaned = 0
  for (const [id, state] of store) {
    if (now - state.updatedAt > EXPIRY_MS) {
      store.delete(id)
      cleaned++
    }
  }
  return cleaned
}
