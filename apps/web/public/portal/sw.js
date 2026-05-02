/**
 * Service Worker do Portal do Cliente.
 *
 * Estratégia minimalista — derivada do sw.js do motorista:
 *  - GET navegação portal: network-first com fallback cache
 *  - Estáticos (_next/static, fonts, images): cache-first (tem hash, safe)
 *  - POST/PATCH/DELETE: sempre network (não interceptamos)
 *
 * Push notifications:
 *  - "OS pronta para retirada"
 *  - "Pagamento confirmado"
 *  - "Orçamento aguardando aprovação"
 *
 * Escopo: '/' raiz portal.pontualtech.com.br (e variantes por slug).
 */

const VERSION = 'v1'
const APP_CACHE = `portal-app-${VERSION}`
const STATIC_CACHE = `portal-static-${VERSION}`

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => {
        if (k !== APP_CACHE && k !== STATIC_CACHE && k.startsWith('portal-')) {
          return caches.delete(k)
        }
      })))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)

  if (url.origin !== self.location.origin) return
  if (req.method !== 'GET') return

  const isPortal = url.pathname.startsWith('/portal')
  const isNextStatic = url.pathname.startsWith('/_next/static')
  const isFont = /\.(woff2?|ttf|eot)$/i.test(url.pathname)
  const isImage = /\.(svg|png|jpg|jpeg|gif|webp|ico)$/i.test(url.pathname)

  if (!isPortal && !isNextStatic && !isFont && !isImage) return

  if (isNextStatic || isFont || isImage) {
    event.respondWith(cacheFirst(req, STATIC_CACHE))
    return
  }

  event.respondWith(networkFirst(req, APP_CACHE))
})

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(req)
  if (hit) return hit
  try {
    const res = await fetch(req)
    if (res.ok) cache.put(req, res.clone())
    return res
  } catch (err) {
    throw err
  }
}

async function networkFirst(req, cacheName) {
  try {
    const res = await fetch(req)
    if (res.ok) {
      const cache = await caches.open(cacheName)
      cache.put(req, res.clone())
    }
    return res
  } catch (err) {
    const cache = await caches.open(cacheName)
    const hit = await cache.match(req)
    if (hit) return hit
    throw err
  }
}

// ============================================================
// PUSH NOTIFICATIONS — OS pronta, pagamento confirmado, etc.
// ============================================================

self.addEventListener('push', (event) => {
  let payload = { title: 'Portal do Cliente', body: '', url: '/', tag: 'default' }
  if (event.data) {
    try { payload = { ...payload, ...event.data.json() } }
    catch { payload.body = event.data.text() }
  }

  const options = {
    body: payload.body,
    tag: payload.tag,
    icon: payload.icon || '/portal/icon-192.png',
    badge: payload.badge || '/portal/icon-192.png',
    data: { url: payload.url },
    requireInteraction: false,
    vibrate: [80, 40, 80],
  }
  event.waitUntil(self.registration.showNotification(payload.title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clientsList) {
      if (client.url.includes('/portal') && 'focus' in client) {
        client.navigate(url)
        return client.focus()
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url)
  })())
})
