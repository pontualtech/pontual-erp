/**
 * GET  /api/voip/calls/[id] — detalhe de uma chamada (CDR + recording metadata + OS vinculada)
 * PUT  /api/voip/calls/[id] — atualiza service_order_id e/ou notes (vincular OS, anotar)
 */

import { NextRequest } from 'next/server'
import { prisma } from '@pontual/db'
import { requireAuth } from '@/lib/auth'
import { error, handleError, success } from '@/lib/api-response'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const user = await requireAuth()

    const call = await prisma.voipCall.findFirst({
      where: {
        id: params.id,
        company_id: user.companyId,
      },
      include: {
        customers: {
          select: { id: true, legal_name: true, trade_name: true, mobile: true, phone: true, document_number: true },
        },
        user_profiles: {
          select: { id: true, name: true, email: true },
        },
        service_orders: {
          select: { id: true, os_number: true, equipment_type: true, equipment_brand: true, equipment_model: true },
        },
      },
    })

    if (!call) {
      return error('Chamada não encontrada', 404)
    }

    return success(call)
  } catch (e) {
    return handleError(e)
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const user = await requireAuth()
    const body = await req.json().catch(() => ({})) as {
      service_order_id?: string | null
      notes?: string
      direction?: 'inbound' | 'outbound'
    }

    // Confirma que a chamada existe + pertence ao tenant (anti-IDOR)
    const existing = await prisma.voipCall.findFirst({
      where: { id: params.id, company_id: user.companyId },
      select: { id: true, customer_id: true, from_number: true, to_number: true, did_number: true, direction: true },
    })
    if (!existing) return error('Chamada não encontrada', 404)

    // Se vinculando OS, valida que OS pertence ao mesmo tenant. Se a chamada já tem
    // customer_id identificado, exige que a OS seja desse mesmo cliente.
    if (body.service_order_id) {
      const os = await prisma.serviceOrder.findFirst({
        where: { id: body.service_order_id, company_id: user.companyId, deleted_at: null },
        select: { id: true, customer_id: true },
      })
      if (!os) return error('OS não encontrada', 404)
      if (existing.customer_id && os.customer_id !== existing.customer_id) {
        return error('OS pertence a outro cliente', 400)
      }
    }

    // Toggle de direção (correção manual quando webhook Sonax classificou errado).
    // Inverte from/to porque a semantica muda: em inbound from=cliente,to=DID;
    // em outbound from=DID,to=cliente.
    let directionUpdate: any = {}
    if (body.direction && (body.direction === 'inbound' || body.direction === 'outbound')) {
      if (body.direction !== existing.direction) {
        directionUpdate = {
          direction: body.direction,
          from_number: existing.to_number,
          to_number: existing.from_number,
        }
      }
    }

    const updated = await prisma.voipCall.update({
      where: { id: params.id },
      data: {
        service_order_id: body.service_order_id === null ? null : body.service_order_id ?? undefined,
        notes: body.notes !== undefined ? body.notes : undefined,
        ...directionUpdate,
        updated_at: new Date(),
      },
      include: {
        service_orders: {
          select: { id: true, os_number: true, equipment_type: true, equipment_brand: true, equipment_model: true },
        },
      },
    })

    return success(updated)
  } catch (e) {
    return handleError(e)
  }
}
