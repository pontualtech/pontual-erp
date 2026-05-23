import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireSuperAdmin } from '@/lib/auth'
import { requireInternalKey } from '@/lib/internal-auth'
import { success, handleError } from '@/lib/api-response'

/**
 * N19 fix (audit pos-fix): leitura de _trigger_failures pra observabilidade
 * dos triggers EXCEPTION-safe (audit log, dual-write AR/AP, fiscal pipeline).
 *
 * A6 fix criou a tabela mas ninguém consultava — bugs ficavam silenciosos
 * em DB. Agora super-admin consegue ver últimas falhas, agrupar por trigger
 * e identificar regressões.
 *
 * GET /api/admin/diag/trigger-failures
 *   ?since=1h|24h|7d (default 24h)
 *   ?trigger=name (filter)
 */
export async function GET(req: NextRequest) {
  try {
    const result = await requireSuperAdmin()
    if (result instanceof NextResponse) return result

    const { searchParams } = new URL(req.url)
    const since = searchParams.get('since') || '24h'
    const triggerFilter = searchParams.get('trigger')

    const sinceMs = since === '1h' ? 60 * 60 * 1000
      : since === '7d' ? 7 * 24 * 60 * 60 * 1000
      : 24 * 60 * 60 * 1000
    const cutoff = new Date(Date.now() - sinceMs)

    let summary: Array<{ trigger_name: string; count: bigint; last_seen: Date }>
    let recent: Array<{ id: number; ran_at: Date; trigger_name: string; payload: any; error_msg: string; error_state: string }>

    try {
      summary = await prisma.$queryRawUnsafe<typeof summary>(
        `SELECT trigger_name, COUNT(*)::bigint AS count, MAX(created_at) AS last_seen
           FROM _trigger_failures
          WHERE created_at > $1
            ${triggerFilter ? `AND trigger_name = $2` : ''}
          GROUP BY trigger_name
          ORDER BY count DESC`,
        ...(triggerFilter ? [cutoff, triggerFilter] : [cutoff]),
      )
      recent = await prisma.$queryRawUnsafe<typeof recent>(
        `SELECT id, created_at AS ran_at, trigger_name, payload,
                error_msg, error_state
           FROM _trigger_failures
          WHERE created_at > $1
            ${triggerFilter ? `AND trigger_name = $2` : ''}
          ORDER BY created_at DESC
          LIMIT 50`,
        ...(triggerFilter ? [cutoff, triggerFilter] : [cutoff]),
      )
    } catch (e: any) {
      // Tabela _trigger_failures pode não existir em ambiente novo
      return success({
        available: false,
        error: e?.message?.slice(0, 200),
        note: 'Tabela _trigger_failures ainda não criada (ensure script não rodou?)',
      })
    }

    const totalFailures = summary.reduce((sum, s) => sum + Number(s.count), 0)
    const alert = totalFailures > 50 // threshold soft

    return success({
      available: true,
      window: since,
      total_failures: totalFailures,
      alert,
      summary: summary.map(s => ({
        trigger_name: s.trigger_name,
        count: Number(s.count),
        last_seen: s.last_seen,
      })),
      recent: recent.map(r => ({
        id: r.id,
        ran_at: r.ran_at,
        trigger_name: r.trigger_name,
        error_msg: r.error_msg?.slice(0, 500),
        error_state: r.error_state,
        payload_summary: r.payload,
      })),
    })
  } catch (err) {
    return handleError(err)
  }
}

/**
 * POST /api/admin/diag/trigger-failures
 *
 * Audit fix 2026-05-23: healthcheck reportava `trigger_failures_unavailable: true`
 * cronicamente porque ensure-financeiro-extras.sh falhava antes de criar a
 * tabela. Esse endpoint é o caminho de auto-cura: super-admin chama 1 vez
 * via curl + POST, tabela é criada idempotente, healthcheck volta verde.
 *
 * Body opcional: nenhum. Cria SOMENTE _trigger_failures (não o resto do ensure).
 * Idempotente — CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
 */
export async function POST(req: NextRequest) {
  try {
    // Audit fix 2026-05-23: aceita 2 caminhos de auth — super-admin (cookie)
    // OU x-internal-key (caminho recovery script/cron). Padrão dos demais
    // endpoints internos. Se header presente, usa internal-key; senão tenta
    // super-admin via cookie.
    if (req.headers.get('x-internal-key')) {
      const guard = requireInternalKey(req)
      if (guard) return guard
    } else {
      const result = await requireSuperAdmin()
      if (result instanceof NextResponse) return result
    }

    // 1. Tabela
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS _trigger_failures (
        id serial primary key,
        trigger_name text NOT NULL,
        payload jsonb,
        error_msg text,
        error_state text,
        created_at timestamptz DEFAULT NOW()
      )
    `)
    // 2. Index pra healthcheck query (created_at DESC) ser O(log n)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_trigger_failures_recent
        ON _trigger_failures (created_at DESC)
    `)
    // 3. Função de registro idempotente (compat com triggers existentes que chamam fn_record_trigger_failure)
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION fn_record_trigger_failure(
        p_trigger text, p_payload jsonb, p_msg text, p_state text
      ) RETURNS void AS $rec$
      BEGIN
        INSERT INTO _trigger_failures (trigger_name, payload, error_msg, error_state)
        VALUES (p_trigger, p_payload, p_msg, p_state);
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'fn_record_trigger_failure ITSELF failed for %: % (%)', p_trigger, SQLERRM, SQLSTATE;
      END;
      $rec$ LANGUAGE plpgsql
    `)

    // 4. Confirma criação
    const check = (await prisma.$queryRawUnsafe(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = '_trigger_failures'
      ) AS exists
    `)) as Array<{ exists: boolean }>

    return success({
      created: true,
      table_exists: check[0]?.exists === true,
      note: 'Healthcheck /api/health agora deve mostrar trigger_failures_1h em vez de trigger_failures_unavailable.',
    })
  } catch (err) {
    return handleError(err)
  }
}
