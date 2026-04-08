import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { authenticateBot } from '../../_lib/auth'
import { botSuccess, botError } from '../../_lib/response'

type Params = { params: { number: string } }

/**
 * GET /api/bot/status-os/[number]
 * Retorna detalhes completos de uma OS pelo número.
 * Auth: X-Bot-Key header ou ?key= query param
 */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const auth = authenticateBot(req)
    if (auth instanceof NextResponse) return auth

    const osNumber = parseInt(params.number, 10)
    if (!osNumber || osNumber < 1) return botError('Numero de OS invalido')

    const os = await prisma.serviceOrder.findFirst({
      where: { os_number: osNumber, company_id: auth.companyId, deleted_at: null },
      include: {
        customers: true,
        module_statuses: { select: { id: true, name: true, color: true, is_final: true } },
        user_profiles: { select: { id: true, name: true } },
        service_order_history: {
          orderBy: { created_at: 'desc' },
          take: 20,
          include: {
            module_statuses_service_order_history_from_status_idTomodule_statuses: { select: { name: true } },
            module_statuses_service_order_history_to_status_idTomodule_statuses: { select: { name: true } },
          },
        },
        service_order_items: {
          where: { deleted_at: null },
          select: { description: true, item_type: true, quantity: true, unit_price: true, total_price: true },
          take: 50,
        },
      },
    })

    if (!os) return botError('OS nao encontrada', 404)

    const c = os.customers
    return botSuccess({
      os_numero: os.os_number,
      os_id: os.id,
      cliente: c ? {
        nome: c.legal_name,
        documento: c.document_number,
        telefone: c.mobile || c.phone,
        email: c.email,
      } : null,
      equipamento: [os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' '),
      equipamento_tipo: os.equipment_type,
      equipamento_marca: os.equipment_brand,
      equipamento_modelo: os.equipment_model,
      numero_serie: os.serial_number,
      defeito_relatado: os.reported_issue,
      diagnostico: os.diagnosis,
      observacoes: os.reception_notes,
      notas_internas: os.internal_notes,
      status: os.module_statuses?.name ?? 'Desconhecido',
      status_cor: os.module_statuses?.color,
      status_final: os.module_statuses?.is_final ?? false,
      prioridade: os.priority,
      tecnico: os.user_profiles?.name ?? null,
      tipo: os.os_type,
      local: os.os_location,
      custo_estimado: os.estimated_cost,
      custo_total: os.total_cost,
      total_pecas: os.total_parts,
      total_servicos: os.total_services,
      forma_pagamento: os.payment_method,
      previsao_entrega: os.estimated_delivery,
      data_entrega: os.actual_delivery,
      garantia: os.is_warranty ?? false,
      garantia_ate: os.warranty_until,
      criado_em: os.created_at,
      atualizado_em: os.updated_at,
      historico: os.service_order_history.map(h => ({
        data: h.created_at,
        de: (h as any).module_statuses_service_order_history_from_status_idTomodule_statuses?.name ?? null,
        para: (h as any).module_statuses_service_order_history_to_status_idTomodule_statuses?.name ?? null,
        por: h.changed_by,
        notas: h.notes,
      })),
      itens: os.service_order_items.map(i => ({
        descricao: i.description,
        tipo: i.item_type,
        quantidade: i.quantity,
        valor_unitario: i.unit_price,
        valor_total: i.total_price,
      })),
    })
  } catch (err: any) {
    console.error('[Bot status-os]', err.message)
    return botError('Erro interno', 500)
  }
}
