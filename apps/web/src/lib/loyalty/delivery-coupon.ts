import crypto from 'crypto'
import { prisma } from '@pontual/db'

// Cupom de fidelidade (2026-10-14, decisão Karlão): dado a TODO cliente na entrega da OS, sem ligação
// com avaliação. Antes o cupom era criado no clique do link "avaliar no Google" — incentivo condicionado
// a avaliação, proibido pela política do Google (risco de remoção de avaliações / suspensão do perfil).
// Mantém source='review' para respeitar o unique (company_id, customer_id, source): 1 cupom por cliente,
// e quem já ganhou no modelo antigo não ganha outro.

export const DEFAULT_COUPON_PERCENT = 10

/** Percentual do setting `loyalty.review_coupon_percent`, limitado a 1–50; inválido/ausente = 10. */
export function couponPercent(settingValue: string | null | undefined): number {
  if (settingValue == null) return DEFAULT_COUPON_PERCENT
  const n = parseInt(settingValue, 10)
  return Number.isFinite(n) && n > 0 ? Math.max(1, Math.min(50, n)) : DEFAULT_COUPON_PERCENT
}

function generateCode(): string {
  return `REVIEW-${crypto.randomBytes(4).toString('hex').toUpperCase()}`
}

/** Cria o cupom de fidelidade do cliente se ele ainda não tem. Nunca lança: falha só é logada. */
export async function grantDeliveryCoupon(companyId: string, customerId: string, osNumber: number | string): Promise<'created' | 'exists' | 'failed'> {
  try {
    const pct = await prisma.setting.findFirst({ where: { company_id: companyId, key: 'loyalty.review_coupon_percent' } })
    const percent = couponPercent(pct?.value)
    for (let i = 0; i < 5; i++) {
      try {
        await prisma.coupon.create({
          data: {
            company_id: companyId,
            customer_id: customerId,
            code: generateCode(),
            source: 'review',
            discount_type: 'percent',
            discount_value: percent,
            notes: `Cupom de fidelidade — entrega da OS #${osNumber} (${new Date().toISOString()})`,
          },
        })
        return 'created'
      } catch (err: any) {
        if (err?.code === 'P2002') {
          const target = err.meta?.target || []
          if (Array.isArray(target) && target.includes('code')) continue // código repetido: gera outro
          return 'exists' // cliente já tem o cupom
        }
        throw err
      }
    }
    return 'failed'
  } catch (err) {
    console.warn('[loyalty] falha ao criar cupom de fidelidade:', err instanceof Error ? err.message : String(err))
    return 'failed'
  }
}
