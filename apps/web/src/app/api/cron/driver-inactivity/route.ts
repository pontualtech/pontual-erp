import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { prisma } from '@pontual/db'
import { success, error, handleError } from '@/lib/api-response'
import { sendWhatsAppCloud } from '@/lib/whatsapp/cloud-api'

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

    // Busca admins por empresa de uma vez (cache por company pra evitar N queries)
    const adminsByCompany = new Map<string, Array<{ id: string; name: string; phone: string | null }>>()
    async function getAdminsForCompany(companyId: string) {
      if (adminsByCompany.has(companyId)) return adminsByCompany.get(companyId)!
      const admins = await prisma.userProfile.findMany({
        where: {
          company_id: companyId, is_active: true,
          phone: { not: null },  // so admins com telefone recebem
          roles: { name: { contains: 'admin', mode: 'insensitive' } },
        },
        select: { id: true, name: true, phone: true },
      })
      adminsByCompany.set(companyId, admins)
      return admins
    }

    const alerted: { id: string; name: string; last_gps_min_ago: number; whatsapp_sent: number }[] = []
    for (const drv of drivers) {
      const last = cronCache.get(drv.id) ?? 0
      if (Date.now() - last < DEDUPE_MINUTES * 60 * 1000) continue

      const minAgo = drv.last_location_at
        ? Math.round((Date.now() - drv.last_location_at.getTime()) / 60000)
        : 999

      // Audit log (fica no DB pro painel mostrar historico)
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

      // WhatsApp pros admins da empresa (free text — requer janela 24h aberta
      // com o admin). Se nao tiver, o envio falha silenciosamente e fica so
      // o audit log.
      const admins = await getAdminsForCompany(drv.company_id)
      const msg = `⚠️ *Alerta de inatividade*\n\nO motorista *${drv.name}* está há *${minAgo} minutos* sem enviar localização (GPS).\n\nÚltimo sinal: ${drv.last_location_at?.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) || '—'}\n\nVerifique se está tudo bem com ele.`
      let whatsappSent = 0
      for (const adm of admins) {
        if (!adm.phone) continue
        try {
          const res = await sendWhatsAppCloud(drv.company_id, adm.phone, msg)
          if (res.success) whatsappSent++
        } catch (e) {
          console.warn(`[driver-inactivity] WhatsApp to ${adm.name} failed:`, (e as Error).message)
        }
      }

      cronCache.set(drv.id, Date.now())
      alerted.push({ id: drv.id, name: drv.name, last_gps_min_ago: minAgo, whatsapp_sent: whatsappSent })
      console.log(`[driver-inactivity] alerta: ${drv.name} sem GPS ha ${minAgo}min (${whatsappSent} WhatsApp(s) enviado(s))`)
    }

    return success({ checked: drivers.length, alerted: alerted.length, alerts: alerted })
  } catch (err) {
    return handleError(err)
  }
}
