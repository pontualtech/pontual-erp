/**
 * Service Worker do PontualRota (app do motorista).
 *
 * Estratégia minimalista — foco em NÃO quebrar nada em prod:
 *  - GET navigations: network-first. Se rede falha, serve do cache. Cache
 *    guarda só a última navegação como fallback (não tentamos precachear
 *    a SPA inteira — Next serve chunks com hash que mudariam).
 *  - GET estáticos (_next/static, fonts, images): cache-first. Safe pq
 *    têm hash no nome.
 *  - POST/PATCH/DELETE: sempre network. NUNCA cacheamos submits. A fila
 *    offline é feita via IndexedDB no client (offline-queue.ts), não via
 *    Background Sync — porque Background Sync depende de registro do SW
 *    o que ainda é instável em Safari iOS.
 *
 * Escopo: /motorista/ apenas. Tudo fora desse path passa reto (networkOnly).
 */

const VERSION = 'v3-cep'
const APP_CACHE = `pontualrota-app-${VERSION}`
const STATIC_CACHE = `pontualrota-static-${VERSION}`

// Paths that must work offline — o shell do app, pra motorista abrir app sem rede
const APP_SHELL = [
  '/motorista/rota',
  '/motorista/chat',
  '/motorista/manifest.webmanifest',
]

self.addEventListener('install', (event) => {
  // Pré-carrega shell, mas sem falhar a instalação se alguma rota der erro
  event.waitUntil(
    caches.open(APP_CACHE).then(cache =>
      Promise.allSettled(APP_SHELL.map(url => cache.add(url)))
    ).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  // Remove caches antigos de versões anteriores
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => {
        if (k !== APP_CACHE && k !== STATIC_CACHE && k.startsWith('pontualrota-')) {
          return caches.delete(k)
        }
      })))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)

  // Só lida com same-origin
  if (url.origin !== self.location.origin) return

  // Nunca intercepta não-GET — submits vão direto pra rede, fila offline
  // é IndexedDB-based no client
  if (req.method !== 'GET') return

  // Escopo: só /motorista e /_next/static (assets dessa sub-app)
  const isMotorista = url.pathname.startsWith('/motorista')
  const isNextStatic = url.pathname.startsWith('/_next/static')
  const isFont = /\.(woff2?|ttf|eot)$/i.test(url.pathname)
  const isImage = /\.(svg|png|jpg|jpeg|gif|webp|ico)$/i.test(url.pathname)

  if (!isMotorista && !isNextStatic && !isFont && !isImage) return

  // Static assets: cache-first (tem hash, safe)
  if (isNextStatic || isFont || isImage) {
    event.respondWith(cacheFirst(req, STATIC_CACHE))
    return
  }

  // Páginas do motorista: network-first, fallback cache
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
    // Sem rede + sem cache — retorna erro padrão do browser
    throw err
  }
}

async function networkFirst(req, cacheName) {
  try {
    const res = await fetch(req)
    // Só cacheia 2xx pra não prender erros de servidor
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
// PUSH NOTIFICATIONS — chat msg do operador / nova rota / etc.
// ============================================================

self.addEventListener('push', (event) => {
  let payload = { title: 'PontualRota', body: '', url: '/motorista/rota', tag: 'default' }
  if (event.data) {
    try { payload = { ...payload, ...event.data.json() } }
    catch { payload.body = event.data.text() }
  }

  const options = {
    body: payload.body,
    tag: payload.tag,
    icon: payload.icon || '/motorista/icon-192.png',
    badge: payload.badge || '/motorista/icon-192.png',
    data: { url: payload.url },
    requireInteraction: false,
    vibrate: [120, 60, 120],   // padrão curto para não incomodar
  }
  event.waitUntil(self.registration.showNotification(payload.title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/motorista/rota'
  event.waitUntil((async () => {
    // Se já tem janela aberta no app do motorista, foca ela em vez de abrir nova
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clientsList) {
      if (client.url.includes('/motorista') && 'focus' in client) {
        client.navigate(url)
        return client.focus()
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url)
  })())
})
