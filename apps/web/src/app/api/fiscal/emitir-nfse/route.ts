import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { z } from 'zod'

const emitNfseSchema = z.object({
  customer_id: z.string(),
  service_order_id: z.string().optional(),
  description: z.string().min(1),
  service_code: z.string().min(1),
  total_amount: z.number().int().positive(),
  notes: z.string().optional(),
})

export async function POST(request: NextRequest) {
  try {
    const result = await requirePermission('fiscal', 'emitir')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await request.json()
    const data = emitNfseSchema.parse(body)

    const config = await prisma.fiscalConfig.findUnique({
      where: { company_id: user.companyId },
    })
    if (!config) return error('Configuracao fiscal nao encontrada', 422)

    const customer = await prisma.customer.findFirst({
      where: { id: data.customer_id, company_id: user.companyId },
    })
    if (!customer) return error('Cliente nao encontrado', 404)

    const invoice = await prisma.invoice.create({
      data: {
        company_id: user.companyId,
        invoice_type: 'NFSE',
        customer_id: data.customer_id,
        service_order_id: data.service_order_id,
        status: 'PROCESSING',
        provider_name: config.provider,
        total_amount: data.total_amount,
        notes: data.notes,
        issued_at: new Date(),
        invoice_items: {
          create: [{
            service_code: data.service_code,
            description: data.description,
            quantity: 1,
            unit_price: data.total_amount,
            total_price: data.total_amount,
          }],
        },
      },
      include: { invoice_items: true },
    })

    // Call Focus NFe NFS-e API
    try {
      const settings = (config.settings && typeof config.settings === 'object') ? config.settings as any : {}
      const focusPayload = {
        prestador: {
          cnpj: settings.cnpj,
          inscricao_municipal: settings.inscricaoMunicipal,
          codigo_municipio: settings.codigoMunicipio,
        },
        tomador: {
          cpf_cnpj: customer.document_number,
          razao_social: customer.legal_name,
          endereco: {
            logradouro: customer.address_street,
            bairro: customer.address_neighborhood,
            codigo_municipio: settings.codigoMunicipio,
            uf: customer.address_state,
            cep: customer.address_zip,
          },
        },
        servico: {
          valor_servicos: (data.total_amount / 100).toFixed(2),
          item_lista_servico: data.service_code,
          discriminacao: data.description,
          codigo_municipio: settings.codigoMunicipio,
        },
      }

      const focusRes = await fetch(
        `https://api.focusnfe.com.br/v2/nfse?ref=${invoice.id}`,
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
      action: 'nfse.emitir',
      entityId: invoice.id,
      newValue: { total_amount: data.total_amount, service_code: data.service_code },
    })

    return success(invoice, 201)
  } catch (err) {
    return handleError(err)
  }
}
