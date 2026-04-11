import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { authenticateBot } from '../_lib/auth'
import { botSuccess, botError } from '../_lib/response'

/**
 * GET /api/bot/consultar?busca=...&limite=5
 * Busca OS por CPF/CNPJ, telefone, numero de OS ou nome do cliente.
 * Auto-detecta o tipo de busca pelo formato.
 * Auth: X-Bot-Key header ou ?key= query param
 */
export async function GET(req: NextRequest) {
  try {
    const auth = authenticateBot(req)
    if (auth instanceof NextResponse) return auth

    const busca = (req.nextUrl.searchParams.get('busca') || '').trim()
    if (!busca) return botError('Parametro "busca" e obrigatorio')

    const limite = Math.min(20, Math.max(1, parseInt(req.nextUrl.searchParams.get('limite') || '5', 10)))
    const digits = busca.replace(/\D/g, '')

    let where: any = { company_id: auth.companyId, deleted_at: null }

    // Auto-detect search type
    if (/^\d+$/.test(digits) && digits.length >= 1 && digits.length <= 6) {
      // OS number
      where.os_number = parseInt(digits, 10)
    } else if (digits.length === 11 || digits.length === 14) {
      // CPF (11) or CNPJ (14)
      where.customers = { document_number: digits }
    } else if (digits.length >= 10 && digits.length <= 13) {
      // Phone number
      const phoneSuffix = digits.slice(-10)
      where.customers = {
        OR: [
          { mobile: { contains: phoneSuffix } },
          { phone: { contains: phoneSuffix } },
        ],
      }
    } else {
      // Name search
      where.customers = { legal_name: { contains: busca, mode: 'insensitive' } }
    }

    let ordens = await prisma.serviceOrder.findMany({
      where,
      take: limite,
      orderBy: { created_at: 'desc' },
      include: {
        customers: {
          select: {
            id: true, legal_name: true, trade_name: true, document_number: true,
            mobile: true, phone: true, email: true,
            address_street: true, address_number: true, address_complement: true,
            address_neighborhood: true, address_city: true, address_state: true, address_zip: true,
          },
        },
        module_statuses: { select: { name: true, color: true } },
        user_profiles: { select: { name: true } },
      },
    })

    // Fallback: if CPF search (11 digits) returned 0, retry as phone number
    if (ordens.length === 0 && digits.length === 11 && where.customers?.document_number) {
      const phoneSuffix = digits.slice(-10)
      ordens = await prisma.serviceOrder.findMany({
        where: {
          company_id: auth.companyId, deleted_at: null,
          customers: {
            OR: [
              { mobile: { contains: phoneSuffix } },
              { phone: { contains: phoneSuffix } },
            ],
          },
        },
        take: limite,
        orderBy: { created_at: 'desc' },
        include: {
          customers: {
            select: {
              id: true, legal_name: true, trade_name: true, document_number: true,
              mobile: true, phone: true, email: true,
              address_street: true, address_number: true, address_complement: true,
              address_neighborhood: true, address_city: true, address_state: true, address_zip: true,
            },
          },
          module_statuses: { select: { name: true, color: true } },
          user_profiles: { select: { name: true } },
        },
      })
    }

    return botSuccess({
      total: ordens.length,
      busca,
      // Include full customer data on first result (for form auto-fill)
      cliente: ordens.length > 0 && ordens[0].customers ? {
        id: ordens[0].customers.id,
        nome: ordens[0].customers.legal_name,
        nome_fantasia: ordens[0].customers.trade_name,
        documento: ordens[0].customers.document_number,
        telefone: ordens[0].customers.mobile || ordens[0].customers.phone || null,
        email: ordens[0].customers.email,
        endereco: ordens[0].customers.address_street,
        numero: ordens[0].customers.address_number,
        complemento: ordens[0].customers.address_complement,
        bairro: ordens[0].customers.address_neighborhood,
        cidade: ordens[0].customers.address_city,
        uf: ordens[0].customers.address_state,
        cep: ordens[0].customers.address_zip,
      } : null,
      ordens: ordens.map(os => ({
        os_numero: os.os_number,
        os_id: os.id,
        cliente_nome: os.customers?.legal_name ?? null,
        cliente_documento: os.customers?.document_number ?? null,
        cliente_telefone: os.customers?.mobile || os.customers?.phone || null,
        cliente_email: os.customers?.email ?? null,
        equipamento: [os.equipment_type, os.equipment_brand, os.equipment_model].filter(Boolean).join(' '),
        defeito: os.reported_issue,
        diagnostico: os.diagnosis,
        status: os.module_statuses?.name ?? 'Desconhecido',
        status_cor: os.module_statuses?.color,
        prioridade: os.priority,
        tecnico: os.user_profiles?.name ?? null,
        custo_total: os.total_cost,
        previsao_entrega: os.estimated_delivery,
        criado_em: os.created_at,
        atualizado_em: os.updated_at,
      })),
      ...(ordens.length === 0 ? { mensagem: `Nenhuma OS encontrada para: ${busca}` } : {}),
    })
  } catch (err: any) {
    console.error('[Bot consultar]', err.message)
    return botError('Erro interno', 500)
  }
}
