import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

// 2026-06-01 (Karlão): adicionada coluna address_zip pra filtro logístico por CEP.
// Motorista vê por padrão (precisa pra coleta/entrega); técnico/financeiro
// não precisam por default mas podem habilitar via column picker.
const ALL_COLUMNS = [
  'os_number', 'created_at', 'customer', 'address_zip', 'equipment_type', 'equipment_brand', 'equipment_model',
  'os_type', 'os_location', 'status', 'total_cost', 'financeiro', 'technician', 'priority',
]

const DEFAULT_HIDDEN: Record<string, string[]> = {
  admin: [],
  atendente: [],
  tecnico: ['financeiro', 'address_zip'],
  motorista: ['total_cost', 'financeiro'], // motorista PRECISA do CEP — não esconder
  financeiro: ['address_zip'],
}

const DEFAULT_OWN_ONLY: Record<string, boolean> = {
  admin: false,
  atendente: false,
  tecnico: false,
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

    // Normalize role name (remove accents) for settings lookup
    const roleKey = user.roleName.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

    // Try both normalized and original key (accented)
    const setting = await prisma.setting.findFirst({
      where: {
        company_id: user.companyId,
        key: { in: [`os_visibility.${roleKey}`, `os_visibility.${user.roleName}`] },
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
    const hidden = DEFAULT_HIDDEN[roleKey] ?? DEFAULT_HIDDEN[user.roleName] ?? ['total_cost', 'financeiro']
    const columns = ALL_COLUMNS.filter(c => !hidden.includes(c))
    const own_only = DEFAULT_OWN_ONLY[roleKey] ?? DEFAULT_OWN_ONLY[user.roleName] ?? false

    return success({ columns, own_only })
  } catch (err) {
    return handleError(err)
  }
}
