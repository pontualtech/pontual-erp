// Diagnostico temporario do volume /app/uploads.
// Adicionado 2026-05-19 pra investigar bug das fotos sumidas.
// REMOVER apos diagnostico concluido.

import { NextResponse } from 'next/server'
import { readdir, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { requirePermission } from '@/lib/auth'

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/app/uploads'

async function listDir(path: string, limit = 20) {
  try {
    if (!existsSync(path)) return { exists: false, entries: [] }
    const entries = await readdir(path)
    const samples = []
    for (const name of entries.slice(0, limit)) {
      try {
        const s = await stat(join(path, name))
        samples.push({
          name,
          isDir: s.isDirectory(),
          size: s.size,
          mtime: s.mtime.toISOString(),
        })
      } catch {
        samples.push({ name, error: true })
      }
    }
    return { exists: true, totalCount: entries.length, sampled: samples.length, entries: samples }
  } catch (e: any) {
    return { exists: existsSync(path), error: e.message }
  }
}

export async function GET() {
  // Restrito a admin: usa requirePermission com permissao ampla.
  const result = await requirePermission('config', 'edit')
  if (result instanceof NextResponse) return result

  return NextResponse.json({
    uploadDir: UPLOAD_DIR,
    uploadDirExists: existsSync(UPLOAD_DIR),
    rootListing: await listDir(UPLOAD_DIR),
    osSubdir: await listDir(join(UPLOAD_DIR, 'os')),
    companySubdir: await listDir(join(UPLOAD_DIR, 'pontualtech-001')),
  })
}
