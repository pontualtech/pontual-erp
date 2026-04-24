import { NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'

/**
 * GET /api/os/charge-accounts
 *
 * Lista contas bancarias ATIVAS com payment provider configurado —
 * usado pela UI da OS pra popular dropdown "Cobrar via qual conta?".
 *
 * Permissao: os:charge (nao expoe dados financeiros completos — so
 * id/nome/banco das contas, sem saldo nem credenciais).
 */
export async function GET() {
  try {
    const auth = await requirePermission('os', 'charge')
    if (auth instanceof NextResponse) return auth

    const accounts = await prisma.account.findMany({
      where: { company_id: auth.companyId, is_active: true },
      select: { id: true, name: true, bank_name: true, provider_config: true },
      orderBy: { name: 'asc' },
    })

    // Filtra so contas que tem provider valido configurado (Asaas/etc)
    const usable = accounts.filter(a => {
      const cfg = (a.provider_config as Record<string, string>) || {}
      return !!cfg.provider && !!cfg.api_key
    }).map(a => ({
      id: a.id,
      name: a.name,
      bank_name: a.bank_name,
      provider: (a.provider_config as Record<string, string>)?.provider,
    }))

    return NextResponse.json({ data: usable })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
