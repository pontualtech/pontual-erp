import { NextRequest, NextResponse } from 'next/server'
import { success, error, handleError } from '@/lib/api-response'

/**
 * Diag/admin de webhooks no Asaas (via API, nao via painel).
 *
 * Asaas API v3 expõe:
 *   - GET /v3/webhooks              → lista webhooks configurados
 *   - POST /v3/webhooks             → cria novo webhook
 *   - PUT /v3/webhooks/{id}         → atualiza webhook
 *   - DELETE /v3/webhooks/{id}      → remove
 *
 * Auth: header X-Internal-Key (env INTERNAL_API_KEY).
 * Roda no IP da VPS (whitelistado no Asaas).
 *
 * GET  /api/internal/asaas/webhooks       → lista
 * POST /api/internal/asaas/webhooks       → body { url, email?, events? } cria/atualiza
 * DELETE /api/internal/asaas/webhooks?id=...
 */

function checkAuth(req: NextRequest): NextResponse | null {
  const internalKey = process.env.INTERNAL_API_KEY || ''
  const provided = req.headers.get('x-internal-key') || ''
  if (!internalKey || provided !== internalKey) {
    return error('Unauthorized', 401)
  }
  return null
}

function asaasFetch(path: string, init: RequestInit = {}) {
  const apiUrl = process.env.ASAAS_API_URL || 'https://api.asaas.com/v3'
  const apiKey = process.env.ASAAS_API_KEY || ''
  return fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      'access_token': apiKey,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  })
}

export async function GET(req: NextRequest) {
  const authErr = checkAuth(req)
  if (authErr) return authErr
  try {
    const r = await asaasFetch('/webhooks')
    const status = r.status
    const body = await r.json().catch(() => ({}))
    return success({ asaas_status: status, body })
  } catch (e) {
    return handleError(e)
  }
}

export async function POST(req: NextRequest) {
  const authErr = checkAuth(req)
  if (authErr) return authErr
  try {
    const input = await req.json()
    // Schema esperado pelo Asaas v3 /webhooks:
    //  { name, url, email, enabled, interrupted, authToken, sendType, events: string[] }
    const payload = {
      name: input.name || 'PontualERP Webhook',
      url: input.url,
      email: input.email || 'dev@pontualtech.com.br',
      enabled: input.enabled !== false,
      interrupted: false,
      authToken: input.authToken || process.env.ASAAS_WEBHOOK_TOKEN,
      sendType: input.sendType || 'SEQUENTIALLY',
      events: input.events || [
        'PAYMENT_CREATED', 'PAYMENT_UPDATED',
        'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED',
        'PAYMENT_OVERDUE', 'PAYMENT_DELETED',
        'PAYMENT_RESTORED', 'PAYMENT_REFUNDED',
        'PAYMENT_RECEIVED_IN_CASH_UNDONE',
        'PAYMENT_CHARGEBACK_REQUESTED',
        'PAYMENT_CHARGEBACK_DISPUTE',
        'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
        'PAYMENT_DUNNING_RECEIVED', 'PAYMENT_DUNNING_REQUESTED',
        'PAYMENT_BANK_SLIP_VIEWED', 'PAYMENT_CHECKOUT_VIEWED',
      ],
    }

    let method = 'POST'
    let path = '/webhooks'
    if (input.id) {
      method = 'PUT'
      path = `/webhooks/${input.id}`
    }

    const r = await asaasFetch(path, { method, body: JSON.stringify(payload) })
    const status = r.status
    const body = await r.json().catch(() => ({}))
    return success({ asaas_status: status, body, sent_payload: payload })
  } catch (e) {
    return handleError(e)
  }
}

export async function DELETE(req: NextRequest) {
  const authErr = checkAuth(req)
  if (authErr) return authErr
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return error('id obrigatorio na query', 400)
    const r = await asaasFetch(`/webhooks/${id}`, { method: 'DELETE' })
    const status = r.status
    const body = await r.json().catch(() => ({}))
    return success({ asaas_status: status, body })
  } catch (e) {
    return handleError(e)
  }
}
