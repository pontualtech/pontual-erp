/**
 * Offline queue para submissions do driver app.
 *
 * Por que IndexedDB e não localStorage:
 *  - localStorage tem limite de ~5MB por origin; um payload de coleta
 *    (assinatura ~20KB + foto 300KB) já consome 6% sozinho. Com 20
 *    submissions empilhadas dá pra estourar.
 *  - IndexedDB é assíncrono, não bloqueia a thread principal, e tem
 *    quota de centenas de MB na maioria dos browsers móveis.
 *  - IndexedDB persiste mesmo depois do motorista fechar o app (PWA
 *    ficar sem cache), garantindo que nenhuma coleta é perdida.
 *
 * Estratégia de retry:
 *  1. Enfileira sempre que handler de finalizar é chamado
 *  2. Tenta enviar imediatamente se navigator.onLine === true
 *  3. Se falhar, incrementa attempts e deixa na fila
 *  4. Registra listener 'online' — quando conexão volta, disparo flush
 *  5. Também tenta flush a cada foco do app (document visibilitychange)
 *  6. Desiste após 20 tentativas, marca status='failed' e guarda
 *     last_error para o motorista decidir (modal "Houve falha — tentar
 *     novamente?")
 *
 * Idempotência: o event_id já está no payload. Servidor retorna 200
 * com {already_completed:true} se recebeu duplicado.
 */

const DB_NAME = 'pontualrota'
const DB_VERSION = 1
const STORE_NAME = 'pending_submissions'

export type QueuedSubmission = {
  id: string                      // uuid local
  endpoint: string                // '/api/driver/stop/XXX/coleta' | '/entrega'
  payload: Record<string, any>    // conteúdo já serializável (base64, não File)
  attempts: number
  last_error?: string
  status: 'pending' | 'in_flight' | 'failed'
  created_at: number              // epoch ms
  updated_at: number
}

// Abre conexão lazy (reusa) — idb nativo sem lib externa pra zero overhead
let dbPromise: Promise<IDBDatabase> | null = null
function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB indisponível'))
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('status', 'status', { unique: false })
        store.createIndex('created_at', 'created_at', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => T | Promise<T>): Promise<T> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode)
    const store = tx.objectStore(STORE_NAME)
    Promise.resolve(fn(store)).then(resolve, reject)
    tx.onerror = () => reject(tx.error)
  })
}

function idbGet<T = any>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// --- API pública ---

/** Enfileira e tenta enviar imediatamente. Retorna id da submission. */
export async function enqueueSubmission(endpoint: string, payload: Record<string, any>): Promise<string> {
  const id = crypto.randomUUID?.() || `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const now = Date.now()
  const item: QueuedSubmission = {
    id, endpoint, payload, attempts: 0, status: 'pending', created_at: now, updated_at: now,
  }
  await withStore('readwrite', store => idbGet(store.put(item)))
  // Dispara flush sem esperar — se der, ótimo; se não, fica na fila
  void flushQueue()
  return id
}

/** Retorna todas as submissions pendentes (para debug/UI badge). */
export async function listPending(): Promise<QueuedSubmission[]> {
  return withStore<QueuedSubmission[]>('readonly', async store => {
    const all = await idbGet<QueuedSubmission[]>(store.getAll())
    return all.filter(s => s.status !== 'failed').sort((a, b) => a.created_at - b.created_at)
  })
}

/** Remove submissions com status=failed (drop manual pelo motorista). */
export async function purgeFailed(): Promise<void> {
  await withStore('readwrite', async store => {
    const all = await idbGet<QueuedSubmission[]>(store.getAll())
    for (const s of all) if (s.status === 'failed') store.delete(s.id)
  })
}

/** Remove submission específica por id. */
export async function removeSubmission(id: string): Promise<void> {
  await withStore('readwrite', store => idbGet(store.delete(id)))
}

/**
 * Envia a próxima pendente. Se sucesso, remove da fila. Se falha, incrementa
 * attempts. Após MAX_ATTEMPTS marca como failed. Parallelismo = 1 pra garantir
 * ordem e não estourar rede em retry.
 */
const MAX_ATTEMPTS = 20
let flushing = false

export async function flushQueue(): Promise<{ sent: number; failed: number; remaining: number }> {
  if (flushing) return { sent: 0, failed: 0, remaining: 0 }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { sent: 0, failed: 0, remaining: (await listPending()).length }
  }
  flushing = true
  let sent = 0
  let failed = 0
  try {
    const pending = await listPending()
    for (const item of pending) {
      try {
        // Marca in_flight pra UI mostrar feedback visual, se houver
        await withStore('readwrite', store => idbGet(store.put({ ...item, status: 'in_flight', updated_at: Date.now() })))

        const res = await fetch(item.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item.payload),
        })
        if (res.ok) {
          await removeSubmission(item.id)
          sent++
        } else {
          // Body de erro 4xx é determinístico — não adianta retry
          const body = await res.text().catch(() => '')
          const isClientError = res.status >= 400 && res.status < 500 && res.status !== 429
          await withStore('readwrite', store => idbGet(store.put({
            ...item,
            attempts: item.attempts + 1,
            last_error: `HTTP ${res.status}: ${body.slice(0, 200)}`,
            status: isClientError || (item.attempts + 1) >= MAX_ATTEMPTS ? 'failed' : 'pending',
            updated_at: Date.now(),
          } as QueuedSubmission)))
          if (isClientError) failed++
        }
      } catch (err) {
        // erro de rede: retry depois
        const last_error = err instanceof Error ? err.message : String(err)
        await withStore('readwrite', store => idbGet(store.put({
          ...item,
          attempts: item.attempts + 1,
          last_error,
          status: item.attempts + 1 >= MAX_ATTEMPTS ? 'failed' : 'pending',
          updated_at: Date.now(),
        } as QueuedSubmission)))
      }
    }
  } finally {
    flushing = false
  }
  const remaining = (await listPending()).length
  return { sent, failed, remaining }
}

/**
 * Registra listeners pra flush automático:
 *  - evento 'online' (browser detectou conexão)
 *  - visibilitychange (app volta ao foco)
 *  - intervalo de 30s como fallback
 * Retorna função de cleanup.
 */
export function startAutoFlush(onChange?: () => void): () => void {
  if (typeof window === 'undefined') return () => {}

  let intervalId: number | null = null

  const tryFlush = async () => {
    const result = await flushQueue()
    if (result.sent > 0 || result.failed > 0) onChange?.()
  }

  const onOnline = () => void tryFlush()
  const onVisible = () => { if (document.visibilityState === 'visible') void tryFlush() }

  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisible)
  intervalId = window.setInterval(() => void tryFlush(), 30_000)
  // Flush inicial ao montar
  void tryFlush()

  return () => {
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisible)
    if (intervalId) window.clearInterval(intervalId)
  }
}
