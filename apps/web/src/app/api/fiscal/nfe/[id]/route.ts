import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import { consultarNfe, cancelarNfe, mapToInternalStatus } from '@/lib/nfe/focus-nfe'

type RouteParams = { params: { id: string } }

// ---------- GET: NF-e detail + auto-poll Focus NFe ----------

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const result = await requirePermission('fiscal', 'read')
    if (result instanceof NextResponse) return result
    const user = result

    const invoice = await prisma.invoice.findFirst({
      where: { id: params.id, company_id: user.companyId, invoice_type: 'NFE' },
      include: {
        customers: { select: { id: true, legal_name: true, document_number: true, email: true } },
        invoice_items: {
          include: {
            products: { select: { id: true, name: true, internal_code: true } },
          },
        },
        fiscal_logs: { orderBy: { created_at: 'desc' }, take: 20 },
      },
    })

    if (!invoice) return error('NF-e nao encontrada', 404)

    // If PROCESSING, check status with Focus NFe
    if (invoice.status === 'PROCESSING' && invoice.provider_ref) {
      const config = await prisma.fiscalConfig.findUnique({
        where: { company_id: user.companyId },
      })

      if (config?.api_key) {
        try {
          const focusResult = await consultarNfe(
            invoice.provider_ref,
            config.api_key,
            config.environment || undefined,
          )

          // Log the polling
          await prisma.fiscalLog.create({
            data: {
              company_id: user.companyId,
              invoice_id: invoice.id,
              action: 'nfe.consultar.poll',
              response: (focusResult.raw_response || {}) as any,
              status_code: 200,
            },
          }).catch(() => {})

          const newStatus = mapToInternalStatus(focusResult.status)

          if (newStatus !== 'PROCESSING') {
            const updateData: any = {
              status: newStatus,
            }

            if (newStatus === 'AUTHORIZED') {
              updateData.authorized_at = new Date()
              updateData.invoice_number = focusResult.numero ? Number(focusResult.numero) : undefined
              updateData.series = focusResult.serie
              updateData.access_key = focusResult.chave_nfe
              updateData.xml_url = focusResult.url_xml
              updateData.danfe_url = focusResult.url_danfe
            }

            if (focusResult.mensagem_sefaz) {
              // Store SEFAZ message in a log
              await prisma.fiscalLog.create({
                data: {
                  company_id: user.companyId,
                  invoice_id: invoice.id,
                  action: `nfe.status.${focusResult.status}`,
                  response: { mensagem_sefaz: focusResult.mensagem_sefaz },
                },
              }).catch(() => {})
            }

            await prisma.invoice.update({
              where: { id: invoice.id },
              data: updateData,
            })

            // Re-read with updated data
            const updated = await prisma.invoice.findFirst({
              where: { id: params.id, company_id: user.companyId },
              include: {
                customers: { select: { id: true, legal_name: true, document_number: true, email: true } },
                invoice_items: {
                  include: {
                    products: { select: { id: true, name: true, internal_code: true } },
                  },
                },
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

// ---------- DELETE: Cancel NF-e ----------

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const result = await requirePermission('fiscal', 'emitir')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()
    const justificativa = body.justificativa

    if (!justificativa || typeof justificativa !== 'string' || justificativa.trim().length < 15) {
      return error('Justificativa deve ter no minimo 15 caracteres', 422)
    }

    const invoice = await prisma.invoice.findFirst({
      where: { id: params.id, company_id: user.companyId, invoice_type: 'NFE' },
    })

    if (!invoice) return error('NF-e nao encontrada', 404)

    if (invoice.status !== 'AUTHORIZED' && invoice.status !== 'PROCESSING') {
      return error('Apenas NF-e autorizadas ou em processamento podem ser canceladas', 422)
    }

    if (!invoice.provider_ref) {
      return error('NF-e sem referencia no provedor', 422)
    }

    const config = await prisma.fiscalConfig.findUnique({
      where: { company_id: user.companyId },
    })

    if (!config?.api_key) {
      return error('API Key do Focus NFe nao configurada', 422)
    }

    // Log cancellation request
    await prisma.fiscalLog.create({
      data: {
        company_id: user.companyId,
        invoice_id: invoice.id,
        action: 'nfe.cancelar.request',
        request: { justificativa } as any,
      },
    }).catch(() => {})

    try {
      await cancelarNfe(
        invoice.provider_ref,
        justificativa,
        config.api_key,
        config.environment || undefined,
      )

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: 'CANCELLED' },
      })

      // Log success
      await prisma.fiscalLog.create({
        data: {
          company_id: user.companyId,
          invoice_id: invoice.id,
          action: 'nfe.cancelar.success',
          response: { justificativa },
          status_code: 200,
        },
      }).catch(() => {})

      logAudit({
        companyId: user.companyId,
        userId: user.id,
        module: 'fiscal',
        action: 'nfe.cancelar',
        entityId: invoice.id,
        oldValue: { status: invoice.status },
        newValue: { status: 'CANCELLED', justificativa },
      })

      return success({ message: 'NF-e cancelada com sucesso' })
    } catch (apiErr: any) {
      // Log error
      await prisma.fiscalLog.create({
        data: {
          company_id: user.companyId,
          invoice_id: invoice.id,
          action: 'nfe.cancelar.error',
          response: { error: apiErr.message },
          status_code: 502,
        },
      }).catch(() => {})

      return error(`Erro ao cancelar NF-e: ${apiErr.message}`, 502)
    }
  } catch (err) {
    return handleError(err)
  }
}
