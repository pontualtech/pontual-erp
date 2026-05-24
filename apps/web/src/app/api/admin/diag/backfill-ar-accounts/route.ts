import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireSuperAdmin } from '@/lib/auth'
import { requireInternalKey } from '@/lib/internal-auth'
import { success, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

/**
 * Wave W (audit 2026-05-24): backfill account_id em ARs legacy
 *
 * Karlão reportou: ARs PAGO/RECEBIDO sem banco vinculado, impossíveis de
 * conciliar. Causa: pré-fix C4 (2026-05-20) o /transition escrevia o
 * account_id APENAS na NOTE ("...— Conta: 0732aeac-..."), nunca no campo
 * `account_id`. 34 ARs históricas com esse problema.
 *
 * Esse endpoint:
 *  - GET: dry-run, conta ARs candidatas (sem alterar)
 *  - POST: aplica backfill — extrai UUID da NOTE, valida que Account
 *    pertence à mesma company, popula account_id
 *
 * Idempotente: já backfilados não são reprocessados (account_id já set).
 * Auth dupla: super-admin (cookie) OU x-internal-key (recovery script).
 */

const ACCOUNT_NOTE_REGEX = /Conta:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

async function authGuard(req: NextRequest) {
  if (req.headers.get('x-internal-key')) {
    const guard = requireInternalKey(req)
    if (guard) return guard
    return null
  }
  const result = await requireSuperAdmin()
  if (result instanceof NextResponse) return result
  return null
}

export async function GET(req: NextRequest) {
  try {
    const guard = await authGuard(req)
    if (guard) return guard

    const url = req.nextUrl.searchParams
    const companyId = url.get('company_id') // opcional — filtra empresa específica

    const where: any = {
      account_id: null,
      deleted_at: null,
      notes: { contains: 'Conta:' },
    }
    if (companyId) where.company_id = companyId

    const candidates = await prisma.accountReceivable.findMany({
      where,
      select: { id: true, company_id: true, status: true, notes: true, payment_method: true, total_amount: true, created_at: true },
      take: 500,
    })

    type CandidateRow = { id: string; company_id: string; status: string | null; notes: string | null; payment_method: string | null; total_amount: number; created_at: Date | null }
    const parsed = (candidates as CandidateRow[]).map((ar) => {
      const match = ACCOUNT_NOTE_REGEX.exec(ar.notes || '')
      return {
        id: ar.id,
        company_id: ar.company_id,
        status: ar.status,
        payment_method: ar.payment_method,
        total_amount: ar.total_amount,
        created_at: ar.created_at,
        extracted_account_id: match?.[1] || null,
      }
    })

    const withAccount = parsed.filter((p) => p.extracted_account_id)
    const noMatch = parsed.filter((p) => !p.extracted_account_id)

    return success({
      total_candidates: candidates.length,
      with_extracted_account: withAccount.length,
      without_match: noMatch.length,
      sample: withAccount.slice(0, 5),
    })
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const guard = await authGuard(req)
    if (guard) return guard

    const body = await req.json().catch(() => ({}))
    const dryRun: boolean = body.dry_run === true
    const companyId: string | undefined = body.company_id

    const where: any = {
      account_id: null,
      deleted_at: null,
      notes: { contains: 'Conta:' },
    }
    if (companyId) where.company_id = companyId

    const candidates = await prisma.accountReceivable.findMany({
      where,
      select: { id: true, company_id: true, notes: true },
      take: 500,
    })

    // Build map: companyId → set de account IDs válidas (pra validar account_id antes de set)
    const companyAccounts = new Map<string, Set<string>>()
    type CandidateBasic = { id: string; company_id: string; notes: string | null }
    const candidatesTyped = candidates as CandidateBasic[]
    const allCompanyIds = Array.from(new Set(candidatesTyped.map((c) => c.company_id)))
    for (const cid of allCompanyIds) {
      const accs = await prisma.account.findMany({
        where: { company_id: cid },
        select: { id: true },
      })
      companyAccounts.set(cid, new Set(accs.map((a: { id: string }) => a.id)))
    }

    let updated = 0
    let skipped_no_match = 0
    let skipped_invalid_account = 0
    const errors: Array<{ ar_id: string; reason: string }> = []

    for (const ar of candidates) {
      const match = ACCOUNT_NOTE_REGEX.exec(ar.notes || '')
      if (!match) {
        skipped_no_match++
        continue
      }
      const extractedId = match[1]
      const validAccounts = companyAccounts.get(ar.company_id) || new Set()
      if (!validAccounts.has(extractedId)) {
        skipped_invalid_account++
        errors.push({ ar_id: ar.id, reason: `account_id ${extractedId} não existe na empresa ${ar.company_id}` })
        continue
      }

      if (!dryRun) {
        try {
          await prisma.accountReceivable.update({
            where: { id: ar.id },
            data: { account_id: extractedId, updated_at: new Date() },
          })
          updated++
        } catch (e: any) {
          errors.push({ ar_id: ar.id, reason: e?.message?.slice(0, 200) || 'update failed' })
        }
      } else {
        updated++
      }
    }

    logAudit({
      companyId: companyId || 'all',
      userId: 'system:backfill',
      module: 'financeiro',
      action: 'backfill_ar_accounts',
      newValue: { dry_run: dryRun, updated, skipped_no_match, skipped_invalid_account, errors_count: errors.length },
    })

    return success({
      dry_run: dryRun,
      candidates_total: candidates.length,
      updated,
      skipped_no_match,
      skipped_invalid_account,
      errors: errors.slice(0, 10),
    })
  } catch (err) {
    return handleError(err)
  }
}
