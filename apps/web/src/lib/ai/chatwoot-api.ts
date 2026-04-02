/**
 * Chatwoot Bot API helper — uses a dedicated bot token (different from the admin token)
 * to send automated messages and manage conversations.
 *
 * Env vars:
 *   CHATWOOT_URL          — e.g. https://chat.pontualtech.work
 *   CHATWOOT_BOT_TOKEN    — Agent Bot API access token
 *   CHATWOOT_ACCOUNT_ID   — Account ID (default "1")
 */

function getConfig() {
  return {
    url: process.env.CHATWOOT_URL || 'https://chat.pontualtech.work',
    token: process.env.CHATWOOT_BOT_TOKEN || process.env.CHATWOOT_API_TOKEN || '',
    accountId: process.env.CHATWOOT_ACCOUNT_ID || '1',
  }
}

function baseUrl() {
  const c = getConfig()
  return `${c.url}/api/v1/accounts/${c.accountId}`
}

function headers() {
  return {
    'Content-Type': 'application/json',
    api_access_token: getConfig().token,
  }
}

async function botFetch<T = any>(path: string, options?: RequestInit): Promise<T> {
  const config = getConfig()
  if (!config.token) {
    throw new Error('CHATWOOT_BOT_TOKEN not configured')
  }

  const res = await fetch(`${baseUrl()}${path}`, {
    ...options,
    headers: {
      ...headers(),
      ...options?.headers,
    },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Chatwoot Bot API ${res.status}: ${body}`)
  }

  // Some endpoints return 204 with no body
  const text = await res.text()
  if (!text) return {} as T
  return JSON.parse(text)
}

/**
 * Send a message to a Chatwoot conversation as the bot.
 */
export async function sendChatwootMessage(
  conversationId: number,
  message: string,
  isPrivate = false
): Promise<void> {
  await botFetch(`/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      content: message,
      message_type: 'outgoing',
      private: isPrivate,
    }),
  })
}

/**
 * Transfer conversation to a human agent by toggling the conversation status
 * and adding an internal note.
 */
export async function transferToHuman(conversationId: number): Promise<void> {
  // 1. Add a private note so the agent knows
  await sendChatwootMessage(
    conversationId,
    '[BOT] Cliente solicitou atendimento humano. Transferindo conversa.',
    true
  )

  // 2. Toggle conversation status to "open" (removes bot assignment)
  await botFetch(`/conversations/${conversationId}/toggle_status`, {
    method: 'POST',
    body: JSON.stringify({ status: 'open' }),
  })
}

/**
 * Assign conversation to a specific agent.
 */
export async function assignConversation(
  conversationId: number,
  agentId: number
): Promise<void> {
  await botFetch(`/conversations/${conversationId}/assignments`, {
    method: 'POST',
    body: JSON.stringify({ assignee_id: agentId }),
  })
}

/**
 * Add label to conversation (e.g., "bot", "humano", "vip").
 */
export async function addLabel(
  conversationId: number,
  labels: string[]
): Promise<void> {
  // Get current labels first
  const conversation = await botFetch<{ labels: string[] }>(
    `/conversations/${conversationId}`
  )
  const currentLabels = conversation.labels || []
  const merged = [...new Set([...currentLabels, ...labels])]

  await botFetch(`/conversations/${conversationId}/labels`, {
    method: 'POST',
    body: JSON.stringify({ labels: merged }),
  })
}

export function isBotConfigured(): boolean {
  const config = getConfig()
  return !!config.token && !!config.url
}
