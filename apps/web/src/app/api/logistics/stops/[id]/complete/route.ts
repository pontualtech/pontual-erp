import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

type Params = { params: { id: string } }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('os', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const stop = await prisma.logisticsStop.findFirst({
      where: { id: params.id, company_id: user.companyId },
      include: { route: true },
    })
    if (!stop) return error('Parada não encontrada', 404)

    if (stop.status === 'COMPLETED') return error('Parada já foi concluída', 422)
    if (stop.status === 'FAILED') return error('Parada marcada como falha', 422)

    const body = await req.json().catch(() => ({}))
    const { photo_urls, signature_url, notes } = body

    // COLETA requires at least one photo
    if (stop.type === 'COLETA') {
      const existingPhotos = Array.isArray(stop.photo_urls) ? stop.photo_urls : []
      const newPhotos = Array.isArray(photo_urls) ? photo_urls : []
      if (existingPhotos.length === 0 && newPhotos.length === 0) {
        return error('Foto obrigatória para coleta', 400)
      }
    }

    // Merge photo_urls
    const currentPhotos = Array.isArray(stop.photo_urls) ? (stop.photo_urls as string[]) : []
    const mergedPhotos = Array.isArray(photo_urls)
      ? [...currentPhotos, ...photo_urls]
      : currentPhotos

    const updated = await prisma.$transaction(async (tx) => {
      // 1. Update stop
      const updatedStop = await tx.logisticsStop.update({
        where: { id: params.id },
        data: {
          status: 'COMPLETED',
          completed_at: new Date(),
          photo_urls: mergedPhotos,
          signature_url: signature_url || stop.signature_url,
          notes: notes || stop.notes,
        },
      })

      // 2. Update route.completed_stops
      await tx.logisticsRoute.update({
        where: { id: stop.route_id },
        data: {
          completed_stops: { increment: 1 },
          updated_at: new Date(),
        },
      })

      // 3. AUTO TRANSITION OS if os_id exists
      if (stop.os_id) {
        const os = await tx.serviceOrder.findFirst({
          where: { id: stop.os_id, company_id: user.companyId, deleted_at: null },
          include: { customers: true },
        })

        if (os) {
          if (stop.type === 'COLETA') {
            // Find "Orçar" status
            const orcarStatus = await tx.moduleStatus.findFirst({
              where: {
                company_id: user.companyId,
                module: 'os',
                name: { contains: 'ar', mode: 'insensitive' },
              },
              orderBy: { order: 'asc' },
            })

            if (orcarStatus) {
              await tx.serviceOrder.update({
                where: { id: os.id },
                data: { status_id: orcarStatus.id, updated_at: new Date() },
              })
              await tx.serviceOrderHistory.create({
                data: {
                  company_id: user.companyId,
                  service_order_id: os.id,
                  from_status_id: os.status_id,
                  to_status_id: orcarStatus.id,
                  changed_by: user.id,
                  notes: 'Coleta realizada — status atualizado automaticamente',
                },
              })
            }
          } else if (stop.type === 'ENTREGA') {
            // Find "Entregue" status (is_final)
            const entregueStatus = await tx.moduleStatus.findFirst({
              where: {
                company_id: user.companyId,
                module: 'os',
                name: { contains: 'Entreg', mode: 'insensitive' },
                is_final: true,
              },
            })

            if (entregueStatus) {
              await tx.serviceOrder.update({
                where: { id: os.id },
                data: {
                  status_id: entregueStatus.id,
                  actual_delivery: new Date(),
                  updated_at: new Date(),
                },
              })
              await tx.serviceOrderHistory.create({
                data: {
                  company_id: user.companyId,
                  service_order_id: os.id,
                  from_status_id: os.status_id,
                  to_status_id: entregueStatus.id,
                  changed_by: user.id,
                  notes: 'Entrega realizada pelo motorista — status atualizado automaticamente',
                },
              })

              // Create AccountReceivable if OS has total_cost
              if ((os.total_cost ?? 0) > 0) {
                const existingAR = await tx.accountReceivable.findFirst({
                  where: { service_order_id: os.id, company_id: user.companyId, deleted_at: null },
                })

                if (!existingAR) {
                  const category = await tx.category.findFirst({
                    where: { company_id: user.companyId, module: 'financeiro_receita' },
                    orderBy: { name: 'asc' },
                  })

                  await tx.accountReceivable.create({
                    data: {
                      company_id: user.companyId,
                      customer_id: os.customer_id,
                      service_order_id: os.id,
                      category_id: category?.id || null,
                      description: `OS-${String(os.os_number).padStart(4, '0')} — ${os.equipment_type || 'Serviço'} ${os.equipment_brand || ''} ${os.equipment_model || ''}`.trim(),
                      total_amount: os.total_cost ?? 0,
                      received_amount: 0,
                      due_date: new Date(),
                      status: 'PENDENTE',
                      payment_method: os.payment_method || 'A definir',
                      notes: `Gerado automaticamente ao entregar OS-${String(os.os_number).padStart(4, '0')} via logística`,
                    },
                  })
                }
              }
            }
          }
        }
      }

      return updatedStop
    })

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'logistics',
      action: 'complete_stop',
      entityId: params.id,
      newValue: { route_id: stop.route_id, os_id: stop.os_id, type: stop.type },
    })

    // Send WhatsApp notification (fire and forget via Chatwoot)
    if (stop.customer_phone) {
      const stopType = stop.type === 'COLETA' ? 'coletado' : 'entregue'
      fetch(`${process.env.NEXT_PUBLIC_APP_URL || ''}/api/integracoes/chatwoot/enviar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: stop.customer_phone,
          message: `Olá${stop.customer_name ? `, ${stop.customer_name}` : ''}! Seu equipamento foi ${stopType} com sucesso. Obrigado pela preferência!`,
        }),
      }).catch(() => {}) // fire and forget
    }

    return success(updated)
  } catch (err) {
    return handleError(err)
  }
}
