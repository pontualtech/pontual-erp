import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

export async function GET(request: NextRequest) {
  try {
    const result = await requirePermission('core', 'read')
    if (result instanceof NextResponse) return result
    const user = result

    const { searchParams } = new URL(request.url)
    const paymentMethod = searchParams.get('payment_method')
    const installments = searchParams.get('installments')

    const settings = await prisma.setting.findMany({
      where: { company_id: user.companyId, key: { startsWith: 'card_fee.' } },
    })

    const configs = settings
      .map((s) => {
        try {
          return { id: s.id, key: s.key, ...JSON.parse(s.value) }
        } catch {
          return null
        }
      })
      .filter(Boolean)

    // If specific payment_method and installments requested, return the matching fee
    if (paymentMethod && installments) {
      const count = parseInt(installments)
      if (isNaN(count) || count < 1) {
        return error('Número de parcelas inválido', 400)
      }

      for (const config of configs) {
        if (!paymentMethod.includes(config.name) && configs.length > 1) continue

        // Check for debit
        if (count === 1 && paymentMethod.includes('Débito') && config.debit_fee_pct != null) {
          return success({
            fee_pct: config.debit_fee_pct,
            days_to_receive: config.days_to_receive || 1,
            config_name: config.name,
          })
        }

        // Check installment ranges
        if (Array.isArray(config.installments)) {
          for (const range of config.installments) {
            if (count >= range.from && count <= range.to) {
              return success({
                fee_pct: range.fee_pct,
                days_to_receive: config.days_to_receive || 30,
                config_name: config.name,
              })
            }
          }
        }
      }

      return success({ fee_pct: 0, days_to_receive: 30, config_name: null })
    }

    return success(configs)
  } catch (err) {
    return handleError(err)
  }
}
