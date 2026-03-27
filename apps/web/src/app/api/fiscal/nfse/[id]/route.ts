import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { consultarNfse, cancelarNfse, mapToInternalStatus } from '@/lib/nfse/focus-nfe'
import { z } from 'zod'

type RouteParams = { params: { id: string } }

// ---------- GET: Invoice detail with provider status check ----------

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const result = await requirePermission('fiscal', 'read')
    if (result instanceof NextResponse) return result
    const user = result

    const invoice = await prisma.invoice.findFirst({
      where: { id: params.id, company_id: user.companyId, invoice_type: 'NFSE' },
      include: {
        customers: {
          select: { id: true, legal_name: true, document_number: true, email: true },
        },
        invoice_items: true,
        fiscal_logs: { orderBy: { created_at: 'desc' }, take: 20 },
      },
    })

    if (!invoice) return error('NFS-e nao encontrada', 404)

    // If PROCESSING, poll Focus NFe for latest status
    if (invoice.status === 'PROCESSING' && invoice.provider_ref) {
      const config = await prisma.fiscalConfig.findUnique({
        where: { company_id: user.companyId },
      })

      if (config?.api_key) {
        try {
          const focusResult = await consultarNfse(
            invoice.provider_ref,
            config.api_key,
            config.environment || undefined,
          )

          // Log the poll
          await prisma.fiscalLog.create({
            data: {
              company_id: user.companyId,
              invoice_id: invoice.id,
              action: 'nfse.consultar',
              response: focusResult.raw_response || {},
              status_code: 200,
            },
          }).catch(() => {})

          const newInternalStatus = mapToInternalStatus(
            focusResult.raw_response?.status as string | undefined
          )

          if (newInternalStatus !== 'PROCESSING') {
            const updateData: any = {
              status: newInternalStatus,
            }

            if (newInternalStatus === 'AUTHORIZED') {
              updateData.authorized_at = new Date()
              if (focusResult.numero_nfse) {
                updateData.invoice_number = Number(focusResult.numero_nfse)
              }
              if (focusResult.codigo_verificacao) {
                updateData.access_key = focusResult.codigo_verificacao
              }
              if (focusResult.url_xml) {
                updateData.xml_url = focusResult.url_xml
              }
              if (focusResult.url_pdf || focusResult.url_nfse) {
                updateData.danfe_url = focusResult.url_pdf || focusResult.url_nfse
              }
            }

            const updated = await prisma.invoice.update({
              where: { id: invoice.id },
              data: updateData,
              include: {
                customers: {
                  select: { id: true, legal_name: true, document_number: true, email: true },
                },
                invoice_items: true,
                fiscal_logs: { orderBy: { created_at: 'desc' }, take: 20 },
              },
            })

            return success(updated)
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

// ---------- DELETE: Cancel NFS-e ----------

const cancelSchema = z.object({
  justificativa: z.string().min(15, 'Justificativa deve ter no minimo 15 caracteres'),
})

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const result = await requirePermission('fiscal', 'emitir')
    if (result instanceof NextResponse) return result
    const user = result

    const invoice = await prisma.invoice.findFirst({
      where: { id: params.id, company_id: user.companyId, invoice_type: 'NFSE' },
    })

    if (!invoice) return error('NFS-e nao encontrada', 404)

    if (invoice.status === 'CANCELLED') {
      return error('Esta NFS-e ja foi cancelada', 422)
    }

    if (invoice.status !== 'AUTHORIZED' && invoice.status !== 'PROCESSING') {
      return error('Somente NFS-e autorizadas ou em processamento podem ser canceladas', 422)
    }

    const body = await request.json()
    const { justificativa } = cancelSchema.parse(body)

    // Load config
    const config = await prisma.fiscalConfig.findUnique({
      where: { company_id: user.companyId },
    })

    if (!config?.api_key) {
      return error('Configuracao fiscal nao encontrada', 422)
    }

    // If authorized, cancel with Focus NFe
    if (invoice.status === 'AUTHORIZED' && invoice.provider_ref) {
      try {
        await cancelarNfse(
          invoice.provider_ref,
          justificativa,
          config.api_key,
          config.environment || undefined,
        )

        // Log cancellation
        await prisma.fiscalLog.create({
          data: {
            company_id: user.companyId,
            invoice_id: invoice.id,
            action: 'nfse.cancelar',
            request: { justificativa },
            status_code: 200,
          },
        }).catch(() => {})
      } catch (apiErr: any) {
        // Log error
        await prisma.fiscalLog.create({
          data: {
            company_id: user.companyId,
            invoice_id: invoice.id,
            action: 'nfse.cancelar.error',
            response: { error: apiErr.message },
            status_code: 422,
          },
        }).catch(() => {})

        return error(`Erro ao cancelar NFS-e: ${apiErr.message}`, 422)
      }
    }

    // Update invoice status
    const updated = await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: 'CANCELLED',
        notes: invoice.notes
          ? `${invoice.notes}\n\n[CANCELADA] ${justificativa}`
          : `[CANCELADA] ${justificativa}`,
      },
      include: {
        customers: {
          select: { id: true, legal_name: true, document_number: true },
        },
        invoice_items: true,
      },
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'fiscal',
      action: 'nfse.cancelar',
      entityId: invoice.id,
      oldValue: { status: invoice.status },
      newValue: { status: 'CANCELLED', justificativa },
    })

    return success(updated)
  } catch (err) {
    return handleError(err)
  }
}
