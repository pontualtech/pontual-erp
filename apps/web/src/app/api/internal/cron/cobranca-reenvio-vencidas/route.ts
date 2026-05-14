import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { resendChargeByPaymentId } from '@/lib/payments/resend-charge'
import { logAudit } from '@/lib/audit'

/**
 * POST /api/internal/cron/cobranca-reenvio-vencidas
 *
 * Cron diario que reenvia link de cobranca de ARs vencidos.
 * Auth: INTERNAL_API_KEY no header x-internal-key.
 *
 * Salvaguardas pra "robustez" (decisao Karlao 2026-05-14: sem cap por
 * cobranca, envia ate cliente pagar):
 *
 *  1. **Cooldown 20h por cobranca**: nao reenvia se charge_sent_at < 20h atras.
 *     Evita re-envio duplo se cron rodar 2x no mesmo dia (Coolify restart).
 *  2. **Limit 50 por execucao**: rate limit Asaas + Meta WhatsApp.
 *  3. **Feature flag `cron.cobranca_reenvio_enabled`** (Setting): default
 *     true. Permite Karlao desligar via DB sem deploy se houver problema.
 *  4. **Audit log de cada execucao**: rastrear envios pra investigacao futura.
 *  5. **Reuso resendChargeByPaymentId**: nao cria charge novo, so reenvia link.
 *
 * Roda via instrumentation.ts uma vez por dia (default 09:00 BRT). Frequencia
 * controlada por env CRON_COBRANCA_REENVIO_HOUR_BRT (default 9).
 */

const PER_RUN_LIMIT = 50
const COOLDOWN_MS = 20 * 60 * 60 * 1000  // 20h

export async function POST(req: NextRequest) {
  const internalKey = req.headers.get('x-internal-key')
  const expectedKey = process.env.INTERNAL_API_KEY
  if (!expectedKey) {
    console.error('[cron/cobranca-reenvio] INTERNAL_API_KEY ausente')
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
  }
  if (!internalKey || internalKey !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // 1. Feature flag — kill switch via Setting (DB sem deploy)
    const flag = await prisma.setting.findFirst({
      where: { key: 'cron.cobranca_reenvio_enabled' },
      select: { value: true, company_id: true },
    })
    if (flag && flag.value === 'false') {
      return NextResponse.json({ data: { skipped: 'feature_flag_off', processed: 0 } })
    }

    const now = new Date()
    // Audit fix 2026-05-14 #2: UTC explicito (era TZ local do server).
    // Server em UTC+0 vs BRT pode causar drift de 3h — cobranca que
    // vence HOJE pode virar "vencida" antecipadamente.
    const today = new Date(now.toISOString().slice(0, 10) + 'T00:00:00.000Z')
    const cooldownThreshold = new Date(now.getTime() - COOLDOWN_MS)

    // 2. Busca candidatos: ARs com charge ativa (charge_id), vencidos,
    // status nao recebido, cooldown passou. Order by oldest first.
    const candidates = await prisma.accountReceivable.findMany({
      where: {
        deleted_at: null,
        status: 'PENDENTE',
        charge_id: { not: null },
        charge_status: { in: ['PENDING', 'OVERDUE'] },
        due_date: { lt: today },
        OR: [
          { charge_sent_at: null },
          { charge_sent_at: { lt: cooldownThreshold } },
        ],
      },
      orderBy: { due_date: 'asc' },
      take: PER_RUN_LIMIT,
      select: { id: true, charge_id: true, company_id: true, due_date: true },
    })

    const results: Array<{
      receivable_id: string
      ok: boolean
      reason?: string
      sent_whatsapp?: boolean
      sent_email?: boolean
    }> = []

    // 3. Processa serialmente (Asaas rate limit)
    for (const c of candidates) {
      if (!c.charge_id) continue
      try {
        const r = await resendChargeByPaymentId({
          paymentId: c.charge_id,
          companyId: c.company_id,
          sendWhatsApp: true,
          sendEmail: true,
        })
        results.push({
          receivable_id: c.id,
          ok: r.ok,
          reason: r.ok ? undefined : r.reason,
          sent_whatsapp: r.ok ? r.sent_whatsapp : undefined,
          sent_email: r.ok ? r.sent_email : undefined,
        })
      } catch (e) {
        results.push({
          receivable_id: c.id,
          ok: false,
          reason: 'exception:' + (e instanceof Error ? e.message : 'unknown'),
        })
      }
    }

    const okCount = results.filter(r => r.ok).length
    const failCount = results.length - okCount

    // 4. Audit log — log por company (uma entry por tenant atingido)
    const byCompany = new Map<string, number>()
    for (const r of results) {
      const c = candidates.find(x => x.id === r.receivable_id)
      if (c) byCompany.set(c.company_id, (byCompany.get(c.company_id) || 0) + 1)
    }
    for (const [companyId, count] of byCompany.entries()) {
      logAudit({
        companyId,
        userId: 'cron-cobranca-reenvio',
        module: 'financeiro',
        action: 'cron_cobranca_reenvio',
        newValue: { count, ok: results.filter(r => r.ok && candidates.find(c => c.id === r.receivable_id)?.company_id === companyId).length },
      })
    }

    return NextResponse.json({
      data: {
        processed: candidates.length,
        ok_count: okCount,
        fail_count: failCount,
        per_company: Object.fromEntries(byCompany),
        cooldown_hours: COOLDOWN_MS / 3600000,
        limit: PER_RUN_LIMIT,
      },
    })
  } catch (err) {
    console.error('[cron/cobranca-reenvio] error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro' }, { status: 500 })
  }
}
