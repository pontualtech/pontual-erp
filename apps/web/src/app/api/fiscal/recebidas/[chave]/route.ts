import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { obterRecebidaCompleta } from '@/lib/nfe/focus-nfe'
import { z } from 'zod'

type RouteParams = { params: { chave: string } }

// ---------- GET: Dados completos da NF-e recebida ----------

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const result = await requirePermission('fiscal', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const config = await prisma.fiscalConfig.findUnique({
      where: { company_id: user.companyId },
    })

    if (!config?.api_key) {
      return error('API Key do Focus NFe nao configurada', 422)
    }

    try {
      const nfeData = await obterRecebidaCompleta(
        params.chave,
        config.api_key,
        config.environment || undefined,
      )

      return success(nfeData)
    } catch (apiErr: any) {
      return error(`Erro ao obter NF-e recebida: ${apiErr.message}`, 502)
    }
  } catch (err) {
    return handleError(err)
  }
}

// ---------- POST: Import NF-e recebida para compras ----------

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const result = await requirePermission('fiscal', 'create')
    if (result instanceof NextResponse) return result
    const user = result

    const config = await prisma.fiscalConfig.findUnique({
      where: { company_id: user.companyId },
    })

    if (!config?.api_key) {
      return error('API Key do Focus NFe nao configurada', 422)
    }

    // Fetch full NF-e data from Focus NFe
    let nfeData: any
    try {
      nfeData = await obterRecebidaCompleta(
        params.chave,
        config.api_key,
        config.environment || undefined,
      )
    } catch (apiErr: any) {
      return error(`Erro ao obter dados da NF-e: ${apiErr.message}`, 502)
    }

    if (!nfeData) {
      return error('NF-e recebida nao encontrada ou sem dados', 404)
    }

    // Check if already imported
    const existing = await prisma.purchaseEntry.findFirst({
      where: {
        company_id: user.companyId,
        invoice_ref: params.chave,
      },
    })

    if (existing) {
      return error('Esta NF-e ja foi importada para compras', 409)
    }

    // Extract emitente (supplier) info
    const emitenteNome = nfeData.nome_emitente || nfeData.razao_social_emitente || 'Fornecedor'
    const emitenteCnpj = nfeData.cnpj_emitente || ''

    // Try to find or create supplier (as customer with type FORNECEDOR)
    let supplier = await prisma.customer.findFirst({
      where: {
        company_id: user.companyId,
        document_number: emitenteCnpj.replace(/\D/g, ''),
        deleted_at: null,
      },
    })

    if (!supplier && emitenteCnpj) {
      supplier = await prisma.customer.create({
        data: {
          company_id: user.companyId,
          legal_name: emitenteNome,
          person_type: 'JURIDICA',
          customer_type: 'FORNECEDOR',
          document_number: emitenteCnpj.replace(/\D/g, ''),
        },
      })
    }

    // Extract items from NF-e data
    const nfeItems: Array<{
      descricao: string
      quantidade: number
      valor_unitario: number // centavos
      valor_total: number // centavos
      ncm?: string
      codigo_produto?: string
    }> = []

    // Focus NFe returns items in different formats
    const rawItems = nfeData.items || nfeData.itens || []

    for (const rawItem of rawItems) {
      const valorUnitario = Math.round((parseFloat(rawItem.valor_unitario_comercial || rawItem.valor_unitario || '0')) * 100)
      const quantidade = parseInt(rawItem.quantidade_comercial || rawItem.quantidade || '1', 10) || 1
      const valorTotal = Math.round((parseFloat(rawItem.valor_bruto || rawItem.valor_total || '0')) * 100) || (valorUnitario * quantidade)

      nfeItems.push({
        descricao: rawItem.descricao || rawItem.nome || 'Produto',
        quantidade,
        valor_unitario: valorUnitario,
        valor_total: valorTotal,
        ncm: rawItem.codigo_ncm || rawItem.ncm,
        codigo_produto: rawItem.codigo_produto,
      })
    }

    // Calculate totals
    const totalCost = nfeItems.reduce((sum, i) => sum + i.valor_total, 0)
    const valorFrete = Math.round((parseFloat(nfeData.valor_frete || '0')) * 100)
    const valorDesconto = Math.round((parseFloat(nfeData.valor_desconto || '0')) * 100)

    // Try to match products by NCM or description
    const allProducts = await prisma.product.findMany({
      where: { company_id: user.companyId, deleted_at: null },
      select: { id: true, name: true, ncm: true, internal_code: true, barcode: true },
    })

    // Create PurchaseEntry + items in transaction
    const purchaseEntry = await prisma.$transaction(async (tx) => {
      // Get next entry number
      const lastEntry = await tx.purchaseEntry.findFirst({
        where: { company_id: user.companyId },
        orderBy: { entry_number: 'desc' },
        select: { entry_number: true },
      })
      const nextNumber = (lastEntry?.entry_number || 0) + 1

      const entry = await tx.purchaseEntry.create({
        data: {
          company_id: user.companyId,
          supplier_id: supplier?.id,
          entry_number: nextNumber,
          status: 'RECEBIDA',
          invoice_ref: params.chave,
          total_cost: totalCost,
          shipping_cost: valorFrete,
          discount: valorDesconto,
          notes: `Importado da NF-e ${params.chave.slice(-10)} - ${emitenteNome}`,
          purchase_entry_items: {
            create: nfeItems.map((item) => {
              // Try to match product
              let productId: string | undefined
              const matchedProduct = allProducts.find(p =>
                (item.codigo_produto && (p.internal_code === item.codigo_produto || p.barcode === item.codigo_produto)) ||
                (item.ncm && p.ncm === item.ncm && p.name.toLowerCase().includes(item.descricao.toLowerCase().slice(0, 10)))
              )
              if (matchedProduct) productId = matchedProduct.id

              // If no match, try to create a placeholder product
              // For now, skip creating products — require manual matching
              return {
                product_id: productId || allProducts[0]?.id || '', // Fallback
                quantity: item.quantidade,
                unit_cost: item.valor_unitario,
                total_cost: item.valor_total,
              }
            }),
          },
        },
        include: {
          purchase_entry_items: {
            include: {
              products: { select: { id: true, name: true } },
            },
          },
          customers: { select: { id: true, legal_name: true } },
        },
      })

      return entry
    })

    // Log the import
    await prisma.fiscalLog.create({
      data: {
        company_id: user.companyId,
        action: 'nfe.recebidas.importar',
        response: {
          chave: params.chave,
          purchase_entry_id: purchaseEntry.id,
          items_count: nfeItems.length,
          total_cost: totalCost,
        } as any,
        status_code: 200,
      },
    }).catch(() => {})

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'fiscal',
      action: 'nfe.recebidas.importar',
      entityId: purchaseEntry.id,
      newValue: {
        chave: params.chave,
        supplier: emitenteNome,
        total_cost: totalCost,
        items_count: nfeItems.length,
      },
    })

    return success(purchaseEntry, 201)
  } catch (err) {
    return handleError(err)
  }
}
