/**
 * POST /api/internal/voip/migrate-extensions
 *
 * Cria tabela voip_extensions se nao existe + popula com os 5 ramais atuais
 * (Roberto/Daniela/Rafael/Vitoria/Claudiomar) lidos do env SONAX_RAMAL_MAPPING
 * + 10 ramais novos vazios (106-115).
 *
 * Idempotente: se ja existe, faz UPSERT dos ramais base e NAO mexe nos extras.
 *
 * Auth: X-Internal-Key.
 *
 * Body opcional: {
 *   create_new_106_115?: boolean  // default true
 *   default_company_id?: string   // default env SONAX_DEFAULT_COMPANY_ID
 * }
 */

import { NextRequest } from 'next/server'
import { prisma } from '@pontual/db'
import { error, handleError, success } from '@/lib/api-response'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function genSecret(): string {
  // Senha SIP: 24 caracteres alfanumericos. Asterisk aceita ate ~64.
  return crypto.randomBytes(18).toString('base64').replace(/[+/=]/g, '').slice(0, 24)
}

const DDL = `
CREATE TABLE IF NOT EXISTS voip_extensions (
  id                 text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  company_id         text NOT NULL REFERENCES companies(id),
  number             varchar(10) NOT NULL,
  description        varchar(120) NOT NULL,
  caller_id_internal varchar(120),
  user_id            text REFERENCES user_profiles(id) ON DELETE SET NULL,
  webrtc             boolean NOT NULL DEFAULT true,
  max_contacts       int NOT NULL DEFAULT 1,
  call_limit         int NOT NULL DEFAULT 1,
  secret_plain       varchar(64) NOT NULL,
  context_tag        varchar(60) NOT NULL DEFAULT 'from-pontualtech',
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz(6) DEFAULT now(),
  updated_at         timestamptz(6) DEFAULT now(),
  CONSTRAINT voip_extensions_company_number_unique UNIQUE (company_id, number)
);

CREATE INDEX IF NOT EXISTS idx_voip_extensions_active
  ON voip_extensions (company_id, is_active);
CREATE INDEX IF NOT EXISTS idx_voip_extensions_user
  ON voip_extensions (user_id);
`

export async function POST(req: NextRequest) {
  try {
    const internalKey = process.env.INTERNAL_API_KEY || ''
    const provided = req.headers.get('x-internal-key') || ''
    if (!internalKey || provided !== internalKey) return error('Unauthorized', 401)

    const body = await req.json().catch(() => ({}))
    const createNew = body.create_new_106_115 !== false
    const companyId = body.default_company_id || process.env.SONAX_DEFAULT_COMPANY_ID || 'pontualtech-001'

    // 1) Cria tabela
    await prisma.$executeRawUnsafe(DDL)

    // 2) Popula ramais existentes (101-105) lendo SONAX_RAMAL_MAPPING
    const mappingRaw = process.env.SONAX_RAMAL_MAPPING || '{}'
    const mapping = JSON.parse(mappingRaw) as Record<string, string>

    let inserted = 0, updated = 0
    for (const [email, number] of Object.entries(mapping)) {
      const user = await prisma.userProfile.findFirst({
        where: { email: email.toLowerCase(), company_id: companyId },
        select: { id: true, name: true },
      })

      // UPSERT idempotente
      const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM voip_extensions WHERE company_id=$1 AND number=$2 LIMIT 1`,
        companyId, number,
      )
      if (existing.length === 0) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO voip_extensions
           (company_id, number, description, caller_id_internal, user_id, webrtc, max_contacts, call_limit, secret_plain)
           VALUES ($1, $2, $3, $4, $5, true, 1, 1, $6)`,
          companyId,
          number,
          `${user?.name || email.split('@')[0]} - Ramal ${number}`,
          user?.name || null,
          user?.id || null,
          genSecret(),
        )
        inserted++
      } else {
        await prisma.$executeRawUnsafe(
          `UPDATE voip_extensions SET user_id=$1, description=$2, caller_id_internal=$3, updated_at=now()
           WHERE id=$4`,
          user?.id || null,
          `${user?.name || email.split('@')[0]} - Ramal ${number}`,
          user?.name || null,
          existing[0].id,
        )
        updated++
      }
    }

    // 3) Cria 106-115 vazios
    let newCreated = 0
    if (createNew) {
      for (let n = 106; n <= 115; n++) {
        const number = String(n)
        const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM voip_extensions WHERE company_id=$1 AND number=$2 LIMIT 1`,
          companyId, number,
        )
        if (existing.length === 0) {
          await prisma.$executeRawUnsafe(
            `INSERT INTO voip_extensions
             (company_id, number, description, webrtc, secret_plain, is_active)
             VALUES ($1, $2, $3, true, $4, false)`,
            companyId, number, `Ramal ${number} (vago)`, genSecret(),
          )
          newCreated++
        }
      }
    }

    // 4) Lista final
    const all = await prisma.$queryRawUnsafe<Array<{ number: string; description: string; user_id: string | null; is_active: boolean }>>(
      `SELECT number, description, user_id, is_active FROM voip_extensions WHERE company_id=$1 ORDER BY number`,
      companyId,
    )

    return success({
      ok: true,
      inserted_existing: inserted,
      updated_existing: updated,
      new_106_115_created: newCreated,
      total_extensions: all.length,
      list: all,
    })
  } catch (e) {
    return handleError(e)
  }
}
