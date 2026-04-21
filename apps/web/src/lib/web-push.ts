import 'server-only'
import webpush from 'web-push'
import { prisma } from '@pontual/db'

let configured = false
function configure() {
  if (configured) return
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || 'mailto:no-reply@pontualtech.work'
  if (!pub || !priv) throw new Error('VAPID keys nao configuradas')
  webpush.setVapidDetails(subject, pub, priv)
  configured = true
}

export type PushPayload = {
  title: string
  body: string
  url?: string                    // pra onde abrir quando user clica
  tag?: string                    // dedup notifications (substituir mesma tag)
  badge?: string
  icon?: string
}

/**
 * Envia push pra TODAS as subscriptions de um usuário (motorista pode ter
 * celular + tablet). Cleanup automático: 410 (gone) ou 404 do push service
 * remove a subscription do banco.
 *
 * Retorna {sent, failed} pra debug. Erros não derrubam o caller —
 * notificações são best-effort.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<{ sent: number; failed: number }> {
  try {
    configure()
  } catch (err) {
    console.warn('[push] configure failed:', err instanceof Error ? err.message : String(err))
    return { sent: 0, failed: 0 }
  }

  const subs = await prisma.driverPushSubscription.findMany({ where: { user_id: userId } })
  if (subs.length === 0) return { sent: 0, failed: 0 }

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || '/motorista/rota',
    tag: payload.tag || 'default',
    badge: payload.badge,
    icon: payload.icon || '/motorista/icon-192.png',
  })

  let sent = 0, failed = 0
  await Promise.all(subs.map(async sub => {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      }, body, { TTL: 60 * 60 * 24 })
      sent++
    } catch (err: any) {
      const status = err?.statusCode
      if (status === 404 || status === 410) {
        // Subscription gone — remove do banco
        await prisma.driverPushSubscription.delete({ where: { id: sub.id } }).catch(() => {})
      } else {
        console.warn('[push] send failed', { endpoint: sub.endpoint.slice(0, 60), status, msg: err?.message })
      }
      failed++
    }
  }))

  return { sent, failed }
}
