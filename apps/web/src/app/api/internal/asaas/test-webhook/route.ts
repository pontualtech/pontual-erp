import { NextRequest } from 'next/server'
import { prisma } from '@pontual/db'
import { success, error, handleError } from '@/lib/api-response'

/**
 * POST /api/internal/asaas/test-webhook
 *
 * Teste end-to-end: cria uma cobranca PIX de teste no Asaas, espera o
 * webhook PAYMENT_CREATED chegar no ERP, verifica se foi processado,
 * e deleta a cobranca no final (cleanup).
 *
 * Auth: X-Internal-Key.
 *
 * Body: { customer_cpf?: string, value?: number, company_id: string }
 *  - customer_cpf default: 04519711835 (Antonio Duarte da OS 60127)
 *  - value default: 500 (R$ 5,00)
 *  - company_id obrigatorio
 *
 * Resposta: { ok, webhook_arrived, asaas_charge_id, elapsed_ms, details }
 */
export async function POST(req: NextRequest) {
  const internalKey = process.env.INTERNAL_API_KEY || ''
  const provided = req.headers.get('x-internal-key') || ''
  if (!internalKey || provided !== internalKey) {
    return error('Unauthorized', 401)
  }

  const body = await req.json().catch(() => ({}))
  const cpf = body.customer_cpf || '04519711835'
  const value = body.value || 500 // R$ 5,00
  const companyId = body.company_id
  if (!companyId) return error('company_id obrigatorio', 400)

  const apiUrl = process.env.ASAAS_API_URL || 'https://api.asaas.com/v3'
  const apiKey = process.env.ASAAS_API_KEY || ''
  if (!apiKey) return error('ASAAS_API_KEY ausente', 500)

  const fetchAsaas = (path: string, init?: RequestInit) =>
    fetch(`${apiUrl}${path}`, {
      ...init,
      headers: { ...(init?.headers || {}), 'access_token': apiKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
    })

  let chargeId: string | null = null
  const startedAt = Date.now()
  const trace: any[] = []

  try {
    // 1. Buscar customer existente por CPF
    const cs = await fetchAsaas(`/customers?cpfCnpj=${cpf}`)
    const csBody = await cs.json()
    const customer = csBody?.data?.[0]
    if (!customer) {
      return success({ ok: false, reason: `Customer com CPF ${cpf} nao encontrado no Asaas` })
    }
    trace.push({ step: 'customer_found', id: customer.id, name: customer.name })

    // 2. Conta count atual de webhookLogs
    const beforeCount = await prisma.webhookLog.count({ where: { company_id: companyId } })
    trace.push({ step: 'before_count', count: beforeCount })

    // 3. Cria cobrança PIX
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const dueDate = tomorrow.toISOString().split('T')[0]
    const cr = await fetchAsaas('/payments', {
      method: 'POST',
      body: JSON.stringify({
        customer: customer.id,
        billingType: 'PIX',
        value: value / 100,
        dueDate,
        description: 'TESTE WEBHOOK — sera deletado em segundos',
        externalReference: `webhook_test_${Date.now()}`,
      }),
    })
    const crBody = await cr.json()
    if (!cr.ok || !crBody.id) {
      return error(`Falha ao criar charge: ${JSON.stringify(crBody)}`, 502)
    }
    chargeId = crBody.id
    trace.push({ step: 'charge_created', id: chargeId, status: crBody.status })

    // 4. Aguarda ate 30s o webhook chegar (poll a cada 1s)
    const targetChargeId: string = chargeId
    let webhookArrived = false
    let arrivedLog: any = null
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000))
      const newLogs = await prisma.webhookLog.findMany({
        where: {
          company_id: companyId,
          created_at: { gt: new Date(startedAt) },
          payload: { path: ['payment', 'id'], equals: targetChargeId },
        },
        orderBy: { created_at: 'desc' },
        take: 1,
      })
      if (newLogs.length > 0) {
        webhookArrived = true
        arrivedLog = newLogs[0]
        trace.push({ step: 'webhook_arrived', after_seconds: i + 1, event: arrivedLog.event, status: arrivedLog.status })
        break
      }
    }
    if (!webhookArrived) {
      // Fallback: webhook pode ter chegado mas o filtro JSON falhou
      const recent = await prisma.webhookLog.count({
        where: { company_id: companyId, created_at: { gt: new Date(startedAt) } },
      })
      trace.push({ step: 'webhook_timeout', logs_since_start: recent - beforeCount })
    }

    return success({
      ok: webhookArrived,
      webhook_arrived: webhookArrived,
      elapsed_ms: Date.now() - startedAt,
      asaas_charge_id: chargeId,
      log: arrivedLog ? { id: arrivedLog.id, event: arrivedLog.event, status: arrivedLog.status, error: arrivedLog.error } : null,
      trace,
    })
  } catch (err) {
    return handleError(err)
  } finally {
    // 5. Cleanup: tenta deletar a charge sempre
    if (chargeId) {
      await fetchAsaas(`/payments/${chargeId}`, { method: 'DELETE' }).catch(() => {})
    }
  }
}
