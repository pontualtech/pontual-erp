import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const url = req.nextUrl.searchParams
    const now = new Date()
    const dateFrom = url.get('dateFrom') || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
    const dateTo = url.get('dateTo') || now.toISOString().split('T')[0]
    const cid = user.companyId

    // Buscar todas as pesquisas no periodo
    const surveys = await prisma.npsSurvey.findMany({
      where: {
        company_id: cid,
        created_at: {
          gte: new Date(`${dateFrom}T00:00:00Z`),
          lte: new Date(`${dateTo}T23:59:59Z`),
        },
      },
      include: {
        customers: {
          select: { legal_name: true },
        },
        service_orders: {
          select: { os_number: true, equipment_type: true },
        },
      },
      orderBy: { created_at: 'desc' },
    })

    const total = surveys.length

    // Calcular distribuicao
    let promoters = 0
    let passives = 0
    let detractors = 0
    let scoreSum = 0

    for (const s of surveys) {
      scoreSum += s.score
      if (s.score >= 9) promoters++
      else if (s.score >= 7) passives++
      else detractors++
    }

    const avgScore = total > 0 ? Math.round((scoreSum / total) * 10) / 10 : 0

    // NPS = % promotores - % detratores
    const promoterPct = total > 0 ? (promoters / total) * 100 : 0
    const passivePct = total > 0 ? (passives / total) * 100 : 0
    const detractorPct = total > 0 ? (detractors / total) * 100 : 0
    const npsScore = total > 0 ? Math.round(promoterPct - detractorPct) : 0

    // Pesquisas recentes com comentarios
    const recentWithComments = surveys
      .filter(s => s.comment)
      .slice(0, 20)
      .map(s => ({
        id: s.id,
        score: s.score,
        comment: s.comment,
        customerName: s.customers.legal_name,
        osNumber: s.service_orders.os_number,
        equipmentType: s.service_orders.equipment_type,
        createdAt: s.created_at,
      }))

    // Todas as pesquisas recentes (max 50)
    const recentSurveys = surveys.slice(0, 50).map(s => ({
      id: s.id,
      score: s.score,
      comment: s.comment,
      customerName: s.customers.legal_name,
      osNumber: s.service_orders.os_number,
      equipmentType: s.service_orders.equipment_type,
      createdAt: s.created_at,
    }))

    // Distribuicao por score (0-10)
    const scoreDistribution = Array.from({ length: 11 }, (_, i) => ({
      score: i,
      count: surveys.filter(s => s.score === i).length,
    }))

    return success({
      npsScore,
      avgScore,
      total,
      promoters,
      passives,
      detractors,
      promoterPct: Math.round(promoterPct * 10) / 10,
      passivePct: Math.round(passivePct * 10) / 10,
      detractorPct: Math.round(detractorPct * 10) / 10,
      scoreDistribution,
      recentWithComments,
      recentSurveys,
    })
  } catch (err) {
    return handleError(err)
  }
}
