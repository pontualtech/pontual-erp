'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface Announcement {
  id: string
  title: string
  message: string
  priority: string
  author_name: string | null
  created_at: string
  require_read?: boolean
  ticket_id?: string | null
}

interface AvisosState {
  announcements: Announcement[]
  loading: boolean
}

// Module-level cache to prevent duplicate fetches across components
let cachedData: Announcement[] | null = null
let lastFetchTime = 0
let fetchPromise: Promise<Announcement[]> | null = null
const POLL_INTERVAL = 10000 // 10 seconds (era 30s — apos feature aviso↔ticket
// avisos chegam em tempo real quando cliente clica no portal. 30s frustra
// atendente. 10s + listener on-focus mantem servidor leve.)
const listeners = new Set<(data: Announcement[]) => void>()

async function doFetch(): Promise<Announcement[]> {
  try {
    const res = await fetch('/api/avisos/unread')
    const json = await res.json()
    if (json.data?.announcements) {
      // Deduplica por id
      const seen = new Set<string>()
      const unique = (json.data.announcements as Announcement[]).filter(a => {
        if (seen.has(a.id)) return false
        seen.add(a.id)
        return true
      })
      cachedData = unique
      lastFetchTime = Date.now()
      return unique
    }
  } catch (err) {
    console.error('[use-avisos] fetch error:', err)
  }
  return cachedData ?? []
}

async function fetchAvisos(): Promise<Announcement[]> {
  // If a fetch is already in flight, reuse it
  if (fetchPromise) return fetchPromise
  // If cache is fresh (< 5s), reuse it
  if (cachedData && Date.now() - lastFetchTime < 5000) return cachedData

  fetchPromise = doFetch().finally(() => { fetchPromise = null })
  const result = await fetchPromise
  // Notify all listeners
  listeners.forEach(fn => fn(result))
  return result
}

// Start global polling interval (only once)
let pollingStarted = false
function startPolling() {
  if (pollingStarted) return
  pollingStarted = true
  setInterval(async () => {
    const data = await doFetch()
    listeners.forEach(fn => fn(data))
  }, POLL_INTERVAL)
}

/**
 * Hook compartilhado para avisos/unread.
 * Usa cache global e polling unico para evitar chamadas duplicadas.
 */
export function useAvisos() {
  const [state, setState] = useState<AvisosState>({
    announcements: cachedData ?? [],
    loading: !cachedData,
  })

  useEffect(() => {
    // Subscribe to updates
    const listener = (data: Announcement[]) => {
      setState({ announcements: data, loading: false })
    }
    listeners.add(listener)

    // Initial fetch
    fetchAvisos().then(data => {
      setState({ announcements: data, loading: false })
    })

    // Start global polling
    startPolling()

    // 2026-05-13: refetch quando aba ganha foco. Atendente troca de tab,
    // resolve algo, volta — quer ver estado atual sem esperar proximo poll.
    // Combinado com POLL_INTERVAL=10s, da UX quase-instantanea.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        doFetch().then(data => listeners.forEach(fn => fn(data)))
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)

    return () => {
      listeners.delete(listener)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [])

  const removeAnnouncement = useCallback((id: string) => {
    if (cachedData) {
      cachedData = cachedData.filter(a => a.id !== id)
    }
    setState(prev => ({
      ...prev,
      announcements: prev.announcements.filter(a => a.id !== id),
    }))
    // Notify other listeners
    listeners.forEach(fn => {
      if (cachedData) fn(cachedData)
    })
  }, [])

  const requiredAnnouncements = state.announcements.filter(a => a.require_read)
  const bellAnnouncements = state.announcements.filter(a => !a.require_read)

  return {
    allAnnouncements: state.announcements,
    requiredAnnouncements,
    bellAnnouncements,
    bellCount: bellAnnouncements.length,
    loading: state.loading,
    removeAnnouncement,
    refetch: fetchAvisos,
  }
}
