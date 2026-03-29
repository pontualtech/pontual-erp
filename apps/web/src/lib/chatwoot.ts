// Leitura das env vars no nível da função para pegar atualizações em runtime
function getChatwootUrl(): string {
  return process.env.CHATWOOT_URL || 'https://chat.pontualtech.work'
}

function getChatwootToken(): string {
  return process.env.CHATWOOT_API_TOKEN || ''
}

function getChatwootAccount(): string {
  return process.env.CHATWOOT_ACCOUNT_ID || '1'
}

function baseUrl() {
  return `${getChatwootUrl()}/api/v1/accounts/${getChatwootAccount()}`
}

function headers() {
  return {
    'Content-Type': 'application/json',
    api_access_token: getChatwootToken(),
  }
}

async function chatwootFetch<T = any>(path: string, options?: RequestInit): Promise<T> {
  if (!getChatwootToken()) {
    throw new Error('CHATWOOT_API_TOKEN not configured')
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
    throw new Error(`Chatwoot API ${res.status}: ${body}`)
  }

  return res.json()
}

// --- Contacts ---

export async function searchContact(phone: string) {
  const data = await chatwootFetch<{ payload: any[] }>(
    `/contacts/search?q=${encodeURIComponent(phone)}`
  )
  return data.payload || []
}

export async function createContact(name: string, phone: string, email?: string) {
  return chatwootFetch(`/contacts`, {
    method: 'POST',
    body: JSON.stringify({
      name,
      phone_number: phone,
      ...(email ? { email } : {}),
    }),
  })
}

// --- Conversations ---

export async function getConversations(contactId: number) {
  const data = await chatwootFetch<{ payload: any[] }>(
    `/contacts/${contactId}/conversations`
  )
  return data.payload || []
}

export async function listConversations(status?: string, inboxId?: number, page?: number) {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  if (inboxId) params.set('inbox_id', String(inboxId))
  if (page) params.set('page', String(page))

  const qs = params.toString()
  return chatwootFetch<{ data: { payload: any[]; meta: any } }>(
    `/conversations${qs ? `?${qs}` : ''}`
  )
}

export async function createConversation(contactId: number, inboxId: number, message?: string) {
  return chatwootFetch(`/conversations`, {
    method: 'POST',
    body: JSON.stringify({
      contact_id: contactId,
      inbox_id: inboxId,
      ...(message ? { message: { content: message } } : {}),
    }),
  })
}

// --- Messages ---

export async function getMessages(conversationId: number) {
  return chatwootFetch<{ payload: any[] }>(
    `/conversations/${conversationId}/messages`
  )
}

export async function sendMessage(conversationId: number, message: string) {
  return chatwootFetch(`/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      content: message,
      message_type: 'outgoing',
    }),
  })
}

// --- Utility: send message to phone (search/create contact + find/create conversation + send) ---

export async function sendMessageToPhone(
  phone: string,
  message: string,
  inboxId: number = 4 // Default: Vendas WhatsApp
) {
  // 1. Search contact by phone
  let contacts = await searchContact(phone)
  let contact = contacts[0]

  // 2. Create contact if not found
  if (!contact) {
    const created = await createContact(phone, phone)
    contact = created
  }

  const contactId = contact.id

  // 3. Find existing open conversation or create new one
  const conversations = await getConversations(contactId)
  const openConversation = conversations.find(
    (c: any) => c.status === 'open' && c.inbox_id === inboxId
  )

  if (openConversation) {
    // Send to existing conversation
    return sendMessage(openConversation.id, message)
  }

  // 4. Create new conversation with initial message
  return createConversation(contactId, inboxId, message)
}

export function isChatwootConfigured(): boolean {
  return !!getChatwootToken()
}
