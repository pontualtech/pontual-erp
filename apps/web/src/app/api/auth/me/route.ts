import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/auth'

export async function GET() {
  const user = await getServerUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  return NextResponse.json({ data: { id: user.id, name: user.name, email: user.email, role: user.roleName, companyId: user.companyId } })
}
