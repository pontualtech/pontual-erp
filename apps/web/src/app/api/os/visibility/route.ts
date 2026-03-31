import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

const ALL_COLUMNS = [
  'os_number', 'created_at', 'customer', 'equipment_type', 'os_type',
  'status', 'total_cost', 'financeiro', 'technician', 'priority',
]

const DEFAULT_HIDDEN: Record<string, string[]> = {
  admin: [],
  atendente: [],
  tecnico: ['financeiro'],
  motorista: ['total_cost', 'financeiro'],
  financeiro: [],
}

const DEFAULT_OWN_ONLY: Record<string, boolean> = {
  admin: false,
  atendente: false,
  tecnico: true,
  motorista: true,
  financeiro: false,
}

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('os', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    // Admin always sees everything
    if (user.roleName === 'admin') {
      return success({ columns: ALL_COLUMNS, own_only: false })
    }

    const setting = await prisma.setting.findUnique({
      where: {
        company_id_key: {
          company_id: user.companyId,
          key: `os_visibility.${user.roleName}`,
        },
      },
    })

    if (setting) {
      const config = JSON.parse(setting.value)
      return success({
        columns: config.columns ?? ALL_COLUMNS,
        own_only: config.own_only ?? false,
      })
    }

    // Defaults
    const hidden = DEFAULT_HIDDEN[user.roleName] ?? ['total_cost', 'financeiro']
    const columns = ALL_COLUMNS.filter(c => !hidden.includes(c))
    const own_only = DEFAULT_OWN_ONLY[user.roleName] ?? false

    return success({ columns, own_only })
  } catch (err) {
    return handleError(err)
  }
}
