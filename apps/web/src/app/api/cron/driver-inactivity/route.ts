import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { prisma } from '@pontual/db'
import { success, error, handleError } from '@/lib/api-response'

/**
 * GET /api/cron/driver-inactivity
 *
 * Chamado pelo cron interno a cada 10min. Encontra motoristas com
 * notify_inactivity=true que estao SEM mandar GPS ha mais que o
 * threshold (default 30min) DURANTE horario comercial (seg-sex, 8-18h).
 *
 * Para cada um, grava um alerta "DRIVER_INACTIVE" na tabela de
 * notificacoes internas (operador ve no painel). Enviar via WhatsApp
 * fica pra sprint separada — por enquanto log + insert.
 *
 * Dedup: se ja enviou alerta nas ultimas 30min pro mesmo motorista,
 * nao envia de novo (evita spam em dias de sinal fraco).
 */

const INACTIVITY_MINUTES = 30
const DEDUPE_MINUTES = 30
const cronCache = new Map<string, number>() // driverId -> last alert timestamp

function isBusinessHours(): boolean {
  const nowBR = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const hour = nowBR.getHours()
  const dow = nowBR.getDay() // 0=Sun, 6=Sat
  return dow >= 1 && dow <= 5 && hour >= 8 && hour < 18
}

export async function GET(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) return error('Cron not configured', 503)
    const authHeader = request.headers.get('authorization')
    const expected = `Bearer ${cronSecret}`
    if (!authHeader || authHeader.length !== expected.length
      || !timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))) {
      return error('Unauthorized', 401)
    }

    if (!isBusinessHours()) {
      return success({ skipped: 'outside business hours' })
    }

    const cutoff = new Date(Date.now() - INACTIVITY_MINUTES * 60 * 1000)

    // Pega motoristas com notify_inactivity + opcionalmente em rota.
    // "Inativo" = tem last_location_at < cutoff (mandou GPS antes mas parou)
    // OU teve GPS hoje mas nao nos ultimos 30min.
    const drivers = await prisma.userProfile.findMany({
      where: {
        is_active: true,
        notify_inactivity: true,
        last_location_at: { lt: cutoff, not: null },
        roles: { OR: [
          { name: { contains: 'motorista', mode: 'insensitive' } },
          { name: { contains: 'driver', mode: 'insensitive' } },
        ]},
      },
      select: {
        id: true, name: true, company_id: true, last_location_at: true,
      },
    })

    const alerted: { id: string; name: string; last_gps_min_ago: number }[] = []
    for (const drv of drivers) {
      const last = cronCache.get(drv.id) ?? 0
      if (Date.now() - last < DEDUPE_MINUTES * 60 * 1000) continue // dedup

      const minAgo = drv.last_location_at
        ? Math.round((Date.now() - drv.last_location_at.getTime()) / 60000)
        : 999

      // Cria registro na tabela de audit_log pra aparecer no painel.
      // (Substituir por notification table quando existir uma)
      await prisma.auditLog.create({
        data: {
          company_id: drv.company_id,
          module: 'logistics',
          action: 'driver_inactive_alert',
          entity_type: 'user_profile',
          entity_id: drv.id,
          new_value: {
            driver_name: drv.name,
            last_gps_at: drv.last_location_at?.toISOString(),
            minutes_since_last_gps: minAgo,
          } as any,
        },
      }).catch(e => console.warn('[driver-inactivity] audit log failed:', e?.message))

      cronCache.set(drv.id, Date.now())
      alerted.push({ id: drv.id, name: drv.name, last_gps_min_ago: minAgo })
      console.log(`[driver-inactivity] alerta: ${drv.name} sem GPS ha ${minAgo}min`)
    }

    return success({ checked: drivers.length, alerted: alerted.length, alerts: alerted })
  } catch (err) {
    return handleError(err)
  }
}
