import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

const nfeItemSchema = z.object({
  product_id: z.string(),
  description: z.string(),
  unit: z.string().default('UN'),
  quantity: z.number().positive(),
  unit_price: z.number().int().positive(),
  ncm: z.string().min(8).max(8),
  cfop: z.string().min(4).max(4),
  cst: z.string().optional(),
})

const emitNfeSchema = z.object({
  customer_id: z.string(),
  service_order_id: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(nfeItemSchema).min(1),
})

export async function POST(request: NextRequest) {
  try {
    const result = await requirePermission('fiscal', 'create')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await request.json()
    const data = emitNfeSchema.parse(body)

    // Load fiscal config
    const config = await prisma.fiscalConfig.findUnique({
      where: { company_id: user.companyId },
    })
    if (!config) return error('Configuracao fiscal nao encontrada. Configure em Fiscal > Configuracoes.', 422)

    // Load customer
    const customer = await prisma.customer.findFirst({
      where: { id: data.customer_id, company_id: user.companyId },
    })
    if (!customer) return error('Cliente nao encontrado', 404)

    // Calculate totals
    const total_amount = data.items.reduce(
      (sum, i) => sum + (i.unit_price * i.quantity), 0
    )

    // Create invoice record
    const invoice = await prisma.invoice.create({
      data: {
        company_id: user.companyId,
        invoice_type: 'NFE',
        customer_id: data.customer_id,
        service_order_id: data.service_order_id,
        status: 'PROCESSING',
        provider_name: config.provider,
        total_amount,
        notes: data.notes,
        issued_at: new Date(),
        invoice_items: {
          create: data.items.map((item) => ({
            product_id: item.product_id,
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unit_price,
            total_price: item.unit_price * item.quantity,
            ncm: item.ncm,
            cfop: item.cfop,
            cst: item.cst,
          })),
        },
      },
      include: { invoice_items: true },
    })

    // Call Focus NFe API
    try {
      const focusPayload = {
        natureza_operacao: 'Venda de mercadoria',
        cnpj_emitente: config.settings && typeof config.settings === 'object' ? (config.settings as any).cnpj : '',
        nome_destinatario: customer.legal_name,
        cpf_cnpj_destinatario: customer.document_number,
        valor_total: (total_amount / 100).toFixed(2),
        items: data.items.map((item, idx) => ({
          numero_item: idx + 1,
          codigo_produto: item.product_id,
          descricao: item.description,
          unidade_comercial: item.unit,
          quantidade_comercial: item.quantity,
          valor_unitario_comercial: (item.unit_price / 100).toFixed(4),
          ncm: item.ncm,
          cfop: item.cfop,
        })),
      }

      const focusRes = await fetch(
        `https://api.focusnfe.com.br/v2/nfe?ref=${invoice.id}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${config.api_key}:`).toString('base64')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(focusPayload),
        }
      )

      const focusData = await focusRes.json()

      if (!focusRes.ok) {
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { status: 'REJECTED' },
        })
        return error(`Erro Focus NFe: ${focusData.mensagem || 'Erro desconhecido'}`, 422)
      }

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { provider_ref: focusData.ref || invoice.id },
      })
    } catch (apiErr: any) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: 'REJECTED' },
      })
      return error(`Falha ao comunicar com Focus NFe: ${apiErr.message}`, 502)
    }

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'fiscal',
      action: 'nfe.emitir',
      entityId: invoice.id,
      newValue: { total_amount, itemCount: data.items.length, customer_id: data.customer_id },
    })

    return success(invoice, 201)
  } catch (err) {
    return handleError(err)
  }
}
