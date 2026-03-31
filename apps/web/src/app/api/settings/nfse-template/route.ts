import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { getServerUser } from '@/lib/auth'
import { requirePermission } from '@/lib/auth'

const DEFAULT_TEMPLATE = 'Reparo em {{equipamento}} marca {{marca}} modelo {{modelo}}, numero de serie {{serie}}, conforme ordem de servico numero {{os_number}}. Garantia {{garantia}} dias.'
const DEFAULT_GARANTIA = '90'

export async function GET() {
  const user = await getServerUser()
  if (!user) return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })

  const setting = await prisma.setting.findUnique({
    where: { company_id_key: { company_id: user.companyId, key: 'nfse_discriminacao_template' } },
  })
  const garantiaSetting = await prisma.setting.findUnique({
    where: { company_id_key: { company_id: user.companyId, key: 'nfse_garantia_dias' } },
  })

  return NextResponse.json({
    template: setting?.value || DEFAULT_TEMPLATE,
    garantia_dias: garantiaSetting?.value || DEFAULT_GARANTIA,
  })
}

export async function PUT(req: NextRequest) {
  const auth = await requirePermission('config', 'manage')
  if (auth instanceof NextResponse) return auth
  const user = auth

  const body = await req.json()
  const { template, garantia_dias } = body

  if (template !== undefined) {
    await prisma.setting.upsert({
      where: { company_id_key: { company_id: user.companyId, key: 'nfse_discriminacao_template' } },
      create: { company_id: user.companyId, key: 'nfse_discriminacao_template', value: template, type: 'string' },
      update: { value: template },
    })
  }

  if (garantia_dias !== undefined) {
    await prisma.setting.upsert({
      where: { company_id_key: { company_id: user.companyId, key: 'nfse_garantia_dias' } },
      create: { company_id: user.companyId, key: 'nfse_garantia_dias', value: String(garantia_dias), type: 'string' },
      update: { value: String(garantia_dias) },
    })
  }

  return NextResponse.json({ success: true })
}
