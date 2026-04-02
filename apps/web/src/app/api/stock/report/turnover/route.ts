import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

export async function GET(request: NextRequest) {
  try {
    const result = await requirePermission('estoque', 'read')
    if (result instanceof NextResponse) return result
    const user = result

    const { searchParams } = new URL(request.url)
    const months = Math.min(24, Math.max(1, Number(searchParams.get('months') || 12)))
    const since = new Date()
    since.setMonth(since.getMonth() - months)

    // Get all products for this company
    const products = await prisma.product.findMany({
      where: {
        company_id: user.companyId,
        deleted_at: null,
        unit: { not: 'SV' }, // only physical products
      },
      select: {
        id: true,
        name: true,
        current_stock: true,
        cost_price: true,
        avg_cost: true,
        category_id: true,
      },
    })

    if (products.length === 0) {
      return success({ summary: { months, total_products: 0 }, products: [] })
    }

    const productIds = products.map(p => p.id)

    // Get EXIT movements (sales/consumption) in the period
    const exitMovements = await prisma.stockMovement.findMany({
      where: {
        company_id: user.companyId,
        product_id: { in: productIds },
        movement_type: 'EXIT',
        created_at: { gte: since },
      },
      select: { product_id: true, quantity: true },
    })

    // Get ENTRY movements in the period (to calculate average stock)
    const entryMovements = await prisma.stockMovement.findMany({
      where: {
        company_id: user.companyId,
        product_id: { in: productIds },
        movement_type: 'ENTRY',
        created_at: { gte: since },
      },
      select: { product_id: true, quantity: true },
    })

    // Aggregate exits per product
    const exitMap = new Map<string, number>()
    for (const m of exitMovements) {
      exitMap.set(m.product_id, (exitMap.get(m.product_id) || 0) + m.quantity)
    }

    // Aggregate entries per product
    const entryMap = new Map<string, number>()
    for (const m of entryMovements) {
      entryMap.set(m.product_id, (entryMap.get(m.product_id) || 0) + m.quantity)
    }

    // Calculate turnover per product
    // Turnover = Total Exits / Average Stock
    // Average Stock = (Initial Stock + Current Stock) / 2
    // Initial Stock (estimated) = Current Stock - Entries + Exits
    const result2 = products.map((p) => {
      const totalExits = exitMap.get(p.id) || 0
      const totalEntries = entryMap.get(p.id) || 0
      const currentStock = p.current_stock ?? 0

      // Estimate initial stock at start of period
      const initialStock = Math.max(0, currentStock - totalEntries + totalExits)
      const avgStock = (initialStock + currentStock) / 2

      // Turnover rate (how many times stock was fully rotated)
      const turnover = avgStock > 0 ? Math.round((totalExits / avgStock) * 100) / 100 : 0

      // Days of stock remaining (based on daily consumption rate)
      const dailyExits = totalExits / (months * 30)
      const daysOfStock = dailyExits > 0
        ? Math.round(currentStock / dailyExits)
        : currentStock > 0 ? 999 : 0

      // Stock value
      const stockValue = currentStock * (p.avg_cost || p.cost_price || 0)

      return {
        product_id: p.id,
        name: p.name,
        current_stock: currentStock,
        total_exits: totalExits,
        total_entries: totalEntries,
        avg_stock: Math.round(avgStock * 100) / 100,
        turnover,
        days_of_stock: daysOfStock,
        stock_value: stockValue,
      }
    })

    // Sort by turnover descending
    result2.sort((a, b) => b.turnover - a.turnover)

    const totalStockValue = result2.reduce((sum, p) => sum + p.stock_value, 0)
    const avgTurnover = result2.length > 0
      ? Math.round(result2.reduce((sum, p) => sum + p.turnover, 0) / result2.length * 100) / 100
      : 0

    const summary = {
      months,
      total_products: result2.length,
      total_stock_value: totalStockValue,
      avg_turnover: avgTurnover,
      slow_movers: result2.filter(p => p.turnover < 1 && p.current_stock > 0).length,
      fast_movers: result2.filter(p => p.turnover >= 4).length,
    }

    return success({ summary, products: result2 })
  } catch (err) {
    return handleError(err)
  }
}
