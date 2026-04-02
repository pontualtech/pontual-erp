import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

type RouteParams = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const result = await requirePermission('fiscal', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const invoice = await prisma.invoice.findFirst({
      where: { id: params.id, company_id: user.companyId },
      include: {
        customers: { select: { id: true, legal_name: true, document_number: true, email: true } },
        invoice_items: true,
        fiscal_logs: { orderBy: { created_at: 'desc' }, take: 20 },
      },
    })

    if (!invoice) return error('Nota fiscal nao encontrada', 404)

    // If PROCESSING, check status with provider
    if (invoice.status === 'PROCESSING' && invoice.provider_ref) {
      const config = await prisma.fiscalConfig.findUnique({
        where: { company_id: user.companyId },
      })

      if (config) {
        try {
          const endpoint = invoice.invoice_type === 'NFSE'
            ? `https://api.focusnfe.com.br/v2/nfse/${invoice.provider_ref}`
            : `https://api.focusnfe.com.br/v2/nfe/${invoice.provider_ref}`

          const res = await fetch(endpoint, {
            headers: {
              Authorization: `Basic ${Buffer.from(`${config.api_key}:`).toString('base64')}`,
            },
          })

          if (res.ok) {
            const providerData = await res.json()
            const newStatus = mapProviderStatus(providerData.status)

            if (newStatus !== 'PROCESSING') {
              await prisma.invoice.update({
                where: { id: invoice.id },
                data: {
                  status: newStatus,
                  invoice_number: providerData.numero ? Number(providerData.numero) : undefined,
                  access_key: providerData.chave_nfe || providerData.codigo_verificacao,
                  xml_url: providerData.caminho_xml_nota_fiscal,
                  danfe_url: providerData.caminho_danfe || providerData.caminho_pdf,
                  authorized_at: newStatus === 'AUTHORIZED' ? new Date() : undefined,
                },
              })
              // Re-read with updated data
              const updated = await prisma.invoice.findFirst({
                where: { id: params.id, company_id: user.companyId },
                include: {
                  customers: { select: { id: true, legal_name: true, document_number: true, email: true } },
                  invoice_items: true,
                  fiscal_logs: { orderBy: { created_at: 'desc' }, take: 20 },
                },
              })
              return success(updated)
            }
          }
        } catch {
          // Ignore provider check errors, return cached data
        }
      }
    }

    return success(invoice)
  } catch (err) {
    return handleError(err)
  }
}

function mapProviderStatus(providerStatus: string) {
  const map = {
    autorizado: 'AUTHORIZED' as const,
    cancelado: 'CANCELLED' as const,
    erro_autorizacao: 'REJECTED' as const,
    denegado: 'REJECTED' as const,
    processando_autorizacao: 'PROCESSING' as const,
  }
  return (map[providerStatus as keyof typeof map] || 'PROCESSING') as 'AUTHORIZED' | 'CANCELLED' | 'REJECTED' | 'PROCESSING'
}
