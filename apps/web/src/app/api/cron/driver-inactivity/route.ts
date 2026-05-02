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
  // N5 fix (audit pos-fix): advisory lock pra 1 instancia rodando por vez
  try {
    const _lock: Array<{ ok: boolean }> = await (prisma as any).$queryRaw`
      SELECT pg_try_advisory_lock(hashtext('cron:driver-inactivity')::bigint) AS ok
    `
    if (!_lock?.[0]?.ok) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'concurrent_run' }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
  } catch { /* non-fatal: tabela/conexao indisponivel — segue sem lock */ }

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

    // Lista opt-in de numeros autorizados a receber alerta, por empresa.
    // Config em Settings.key = 'logistics.inactivity_alert.phones' (valor =
    // numeros separados por virgula, ex: "11999998888, 11988887777").
    // Se estiver vazio, NAO envia WhatsApp — so grava audit log. Isso
    // impede que o alerta vaze pra cliente caso algum UserProfile
    // tenha role com "admin" no nome por engano.
    const numbersByCompany = new Map<string, string[]>()
    async function getNumbersForCompany(companyId: string): Promise<string[]> {
      if (numbersByCompany.has(companyId)) return numbersByCompany.get(companyId)!
      const setting = await prisma.setting.findFirst({
        where: { company_id: companyId, key: 'logistics.inactivity_alert.phones' },
        select: { value: true },
      })
      const raw = setting?.value || ''
      const numbers = raw.split(/[,;\n]/).map(s => s.replace(/\D/g, '')).filter(n => n.length >= 10)
      numbersByCompany.set(companyId, numbers)
      return numbers
    }

    const alerted: { id: string; name: string; last_gps_min_ago: number; whatsapp_sent: number }[] = []
    for (const drv of drivers) {
      const last = cronCache.get(drv.id) ?? 0
      if (Date.now() - last < DEDUPE_MINUTES * 60 * 1000) continue

      const minAgo = drv.last_location_at
        ? Math.round((Date.now() - drv.last_location_at.getTime()) / 60000)
        : 999

      // Audit log (fica no DB pro painel mostrar historico).
      // user_id e o proprio motorista — a acao e "sistema detectou que ele
      // ficou inativo" (nao tem outro user pra atribuir, o cron nao roda
      // como usuario).
      await prisma.auditLog.create({
        data: {
          company_id: drv.company_id,
          user_id: drv.id,
          module: 'logistics',
          action: 'driver_inactive_alert',
          entity_id: drv.id,
          new_value: {
            driver_name: drv.name,
            last_gps_at: drv.last_location_at?.toISOString(),
            minutes_since_last_gps: minAgo,
          } as any,
        },
      }).catch(e => console.warn('[driver-inactivity] audit log failed:', e?.message))

      // WhatsApp so pra numeros configurados em setting (opt-in explicito).
      // Se vazio, alerta fica apenas no audit log — nao manda WhatsApp pra
      // ninguem. Isso evita spam de admin com role loose E garante que
      // cliente NUNCA recebe.
      const phones = await getNumbersForCompany(drv.company_id)
      let whatsappSent = 0
      if (phones.length > 0) {
        const msg = `⚠️ *Alerta interno*\n\nO motorista *${drv.name}* está há *${minAgo} minutos* sem enviar localização (GPS).\n\nÚltimo sinal: ${drv.last_location_at?.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) || '—'}\n\nVerifique se está tudo bem com ele.`
        for (const phone of phones) {
          try {
            const res = await sendWhatsAppCloud(drv.company_id, phone, msg)
            if (res.success) whatsappSent++
          } catch (e) {
            console.warn(`[driver-inactivity] WhatsApp to ${phone} failed:`, (e as Error).message)
          }
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
