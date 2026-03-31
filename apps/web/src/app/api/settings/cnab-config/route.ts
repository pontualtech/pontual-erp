import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getServerUser, requirePermission } from '@/lib/auth'

const KEYS = ['cnab.cnpj', 'cnab.razao_social', 'cnab.agencia', 'cnab.conta', 'cnab.convenio', 'cnab.carteira', 'inter.client_id', 'inter.client_secret']
const KEY_MAP: Record<string, string> = {
  cnpj: 'cnab.cnpj',
  razao_social: 'cnab.razao_social',
  agencia: 'cnab.agencia',
  conta: 'cnab.conta',
  convenio: 'cnab.convenio',
  carteira: 'cnab.carteira',
  inter_client_id: 'inter.client_id',
  inter_client_secret: 'inter.client_secret',
}

export async function GET() {
  const user = await getServerUser()
  if (!user) return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })

  const settings = await prisma.setting.findMany({
    where: { company_id: user.companyId, key: { in: KEYS } },
  })

  const result: Record<string, string> = {}
  for (const s of settings) {
    const shortKey = Object.entries(KEY_MAP).find(([, v]) => v === s.key)?.[0]
    if (shortKey) result[shortKey] = s.value
  }

  return NextResponse.json(result)
}

export async function PUT(req: NextRequest) {
  const auth = await requirePermission('config', 'edit')
  if (auth instanceof NextResponse) return auth
  const user = auth

  const body = await req.json()

  for (const [shortKey, dbKey] of Object.entries(KEY_MAP)) {
    if (body[shortKey] !== undefined) {
      await prisma.setting.upsert({
        where: { company_id_key: { company_id: user.companyId, key: dbKey } },
        create: { company_id: user.companyId, key: dbKey, value: String(body[shortKey]), type: 'string' },
        update: { value: String(body[shortKey]) },
      })
    }
  }

  return NextResponse.json({ success: true })
}
