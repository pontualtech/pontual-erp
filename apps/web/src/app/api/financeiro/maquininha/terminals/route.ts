import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

/**
 * GET /api/financeiro/maquininha/terminals
 *
 * Lista assignments de maquininhas. Por default mostra so vigentes;
 * `?include_history=1` traz tudo incluindo encerrados.
 *
 * Resposta: Array<{
 *   id, terminal_code, assignment_type, user_id, user_name,
 *   valid_from, valid_to, notes
 * }>
 */
export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const includeHistory = req.nextUrl.searchParams.get('include_history') === '1'

    const where: any = { company_id: user.companyId }
    if (!includeHistory) where.valid_to = null

    const list = await prisma.acquirerTerminalAssignment.findMany({
      where,
      include: { user_profiles: { select: { id: true, name: true } } },
      orderBy: [{ terminal_code: 'asc' }, { valid_from: 'desc' }],
    })

    return success(list.map(t => ({
      id: t.id,
      acquirer: t.acquirer,
      terminal_code: t.terminal_code,
      assignment_type: t.assignment_type,
      user_id: t.user_id,
      user_name: t.user_profiles?.name || null,
      valid_from: t.valid_from,
      valid_to: t.valid_to,
      notes: t.notes,
    })))
  } catch (err) {
    return handleError(err)
  }
}

/**
 * POST /api/financeiro/maquininha/terminals
 *
 * Cria/atualiza assignment de maquininha. Se ja houver vigencia ativa
 * pra esse terminal_code, ela e ENCERRADA automaticamente (valid_to=hoje)
 * e uma nova vigencia comeca.
 *
 * Body: {
 *   terminal_code: string,
 *   assignment_type: 'DRIVER' | 'STORE',
 *   user_id?: string (obrigatorio se DRIVER),
 *   acquirer?: string (default 'rede'),
 *   valid_from?: 'YYYY-MM-DD' (default hoje),
 *   notes?: string,
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()
    const { terminal_code, assignment_type, user_id, acquirer, valid_from, notes } = body

    if (!terminal_code || typeof terminal_code !== 'string') {
      return error('terminal_code obrigatorio', 400)
    }
    if (!['DRIVER', 'STORE'].includes(assignment_type)) {
      return error('assignment_type deve ser DRIVER ou STORE', 400)
    }
    if (assignment_type === 'DRIVER' && !user_id) {
      return error('user_id obrigatorio quando assignment_type=DRIVER', 400)
    }
    if (assignment_type === 'STORE' && user_id) {
      return error('user_id deve ser nulo quando assignment_type=STORE', 400)
    }

    const startDate = valid_from ? new Date(valid_from) : new Date()
    startDate.setHours(0, 0, 0, 0)

    const created = await prisma.$transaction(async (tx) => {
      // Encerra vigencia atual se houver
      const yesterday = new Date(startDate)
      yesterday.setDate(yesterday.getDate() - 1)
      await tx.acquirerTerminalAssignment.updateMany({
        where: {
          company_id: user.companyId,
          terminal_code,
          valid_to: null,
        },
        data: { valid_to: yesterday, updated_at: new Date() },
      })

      // Cria nova
      return tx.acquirerTerminalAssignment.create({
        data: {
          company_id: user.companyId,
          acquirer: acquirer || 'rede',
          terminal_code,
          assignment_type,
          user_id: user_id || null,
          valid_from: startDate,
          notes: notes || null,
        },
      })
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'terminal_assignment',
      entityId: created.id,
      newValue: { terminal_code, assignment_type, user_id, valid_from: startDate },
    })

    return success(created)
  } catch (err) {
    return handleError(err)
  }
}
