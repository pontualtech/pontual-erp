/**
 * Download e armazenamento de gravações MP3 do Sonax.
 *
 * Sonax expõe URL CDN do MP3 no webhook Disconnect. Esta lib:
 * 1. Baixa o MP3 via fetch
 * 2. Salva no volume Docker /var/recordings/ (container-local)
 * 3. Retorna path local pra ser servido via signed URL no Next route handler
 *
 * Estrutura de paths:
 *   /var/recordings/{companyId}/{YYYY}/{MM}/{callId}.mp3
 *
 * Em produção, montar /var/recordings em volume persistente do Coolify
 * (Persistent Storage tab) pra sobreviver rebuilds. Fallback: downloads
 * sob demanda quando faltar (idempotente).
 */

import { promises as fs } from 'fs'
import path from 'path'

const RECORDINGS_BASE = process.env.VOIP_RECORDINGS_PATH || '/var/recordings'

export interface DownloadResult {
  ok: boolean
  localPath?: string
  sizeBytes?: number
  error?: string
}

/**
 * Baixa o MP3 de uma URL Sonax e salva no volume local.
 * Idempotente: se arquivo já existe (mesmo path), retorna sucesso sem rebaixar.
 */
export async function downloadRecording(params: {
  recordingUrl: string
  companyId: string
  callId: string
  startedAt: Date
}): Promise<DownloadResult> {
  const { recordingUrl, companyId, callId, startedAt } = params

  if (!recordingUrl || !recordingUrl.startsWith('http')) {
    return { ok: false, error: 'URL de gravação inválida' }
  }

  // Path: /var/recordings/{companyId}/{YYYY}/{MM}/{callId}.mp3
  const yyyy = String(startedAt.getUTCFullYear())
  const mm = String(startedAt.getUTCMonth() + 1).padStart(2, '0')
  const dir = path.join(RECORDINGS_BASE, companyId, yyyy, mm)
  const fullPath = path.join(dir, `${callId}.mp3`)

  // Idempotência: já baixado?
  try {
    const stat = await fs.stat(fullPath)
    if (stat.size > 0) {
      return { ok: true, localPath: fullPath, sizeBytes: stat.size }
    }
  } catch {
    // não existe — continua download
  }

  // Download — TUDO dentro do try (mkdir pode falhar se Persistent Storage
  // nao montado e dir nao tem write permission)
  try {
    await fs.mkdir(dir, { recursive: true })

    const res = await fetch(recordingUrl, {
      signal: AbortSignal.timeout(60_000),  // 1 min — gravação grande pode demorar
    })
    if (!res.ok) {
      return { ok: false, error: `Sonax CDN HTTP ${res.status}` }
    }

    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.length < 100) {
      return { ok: false, error: 'Gravação muito pequena (provável erro CDN)' }
    }

    await fs.writeFile(fullPath, buffer)

    return { ok: true, localPath: fullPath, sizeBytes: buffer.length }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'erro download'
    return { ok: false, error: msg }
  }
}

/**
 * Lê arquivo de gravação local (pra servir via Next route handler).
 * Retorna null se não existe.
 */
export async function readRecording(localPath: string): Promise<Buffer | null> {
  // Segurança: rejeita paths fora de RECORDINGS_BASE
  const resolved = path.resolve(localPath)
  const baseResolved = path.resolve(RECORDINGS_BASE)
  if (!resolved.startsWith(baseResolved)) {
    return null
  }

  try {
    return await fs.readFile(resolved)
  } catch {
    return null
  }
}

/**
 * Puxa gravação via API server-to-server Sonax (mais robusta que recording_url
 * direta do CDN, que pode retornar "404 not found" em body 200 quando ainda
 * nao processada).
 *
 * Doc Sonax KB 159253:
 *   GET https://api.sonax.net.br/a2billing_v2/admin/Public/dbdial_webapi.php
 *     ?acao=pega_gravacao
 *     &id_cliente=<ID>
 *     &token=<TOKEN>
 *     &id_chamada=<ID_CHAMADA>
 *     &recordmp3=1
 *   → arquivo MP3 (ou ZIP se multiple gravações de transferência)
 */
export async function fetchRecordingViaSonaxApi(idChamada: string): Promise<{
  ok: boolean
  buffer?: Buffer
  contentType?: string
  error?: string
}> {
  const token = process.env.SONAX_API_TOKEN
  const clientId = process.env.SONAX_WEBPHONE_CLIENT_ID
  if (!token || !clientId) {
    return { ok: false, error: 'SONAX_API_TOKEN ou CLIENT_ID nao configurado' }
  }
  const url = new URL('https://api.sonax.net.br/a2billing_v2/admin/Public/dbdial_webapi.php')
  url.searchParams.set('acao', 'pega_gravacao')
  url.searchParams.set('id_cliente', clientId)
  url.searchParams.set('token', token)
  url.searchParams.set('id_chamada', idChamada)
  url.searchParams.set('recordmp3', '1')

  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(60_000) })
    if (!res.ok) return { ok: false, error: `Sonax API HTTP ${res.status}` }
    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.length < 100) {
      // Provavel "404 not found" em body texto
      const text = buffer.toString('utf-8').trim()
      return { ok: false, error: `Sonax respondeu: ${text || 'arquivo vazio'}` }
    }
    return {
      ok: true,
      buffer,
      contentType: res.headers.get('content-type') || 'audio/mpeg',
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'erro desconhecido' }
  }
}

/**
 * Apaga gravação local (LGPD direito ao esquecimento).
 */
export async function deleteRecording(localPath: string): Promise<boolean> {
  const resolved = path.resolve(localPath)
  const baseResolved = path.resolve(RECORDINGS_BASE)
  if (!resolved.startsWith(baseResolved)) return false

  try {
    await fs.unlink(resolved)
    return true
  } catch {
    return false
  }
}
