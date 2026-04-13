import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { authenticateBot } from '../_lib/auth'
import { botSuccess, botError } from '../_lib/response'

/**
 * PUT /api/bot/atualizar-os
 * Atualiza OS existente: status, diagnostico, notas, custo, previsao.
 * Status é resolvido por nome (não por UUID).
 * Auth: X-Bot-Key header ou ?key= query param
 */
export async function PUT(req: NextRequest) {
  try {
    const auth = authenticateBot(req)
    if (auth instanceof NextResponse) return auth

    const body = await req.json()
    const { os_numero, status, diagnostico, observacoes, notas_internas, custo_estimado, previsao_entrega } = body

    if (!os_numero) return botError('Campo "os_numero" e obrigatorio')

    const companyId = auth.companyId
    const osNumber = parseInt(String(os_numero), 10)
    if (!osNumber) return botError('Numero de OS invalido')

    const os = await prisma.serviceOrder.findFirst({
      where: { os_number: osNumber, company_id: companyId, deleted_at: null },
      include: { module_statuses: { select: { id: true, name: true, is_final: true, transitions: true } } },
    })

    if (!os) return botError(`OS ${osNumber} nao encontrada`, 404)

    const updateData: any = {}
    const camposAtualizados: string[] = []
    const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    let statusAnterior = os.module_statuses?.name ?? 'Desconhecido'
    let statusAtual = statusAnterior
    let newStatusId: string | null = null

    // Resolve status by name
    if (status) {
      const targetStatus = await prisma.moduleStatus.findFirst({
        where: {
          company_id: companyId,
          module: 'os',
          name: { contains: status, mode: 'insensitive' },
        },
      })

      if (!targetStatus) {
        const available = await prisma.moduleStatus.findMany({
          where: { company_id: companyId, module: 'os' },
          select: { name: true },
          orderBy: { order: 'asc' },
        })
        return botError(`Status "${status}" nao encontrado. Disponiveis: ${available.map(s => s.name).join(', ')}`)
      }

      // Validate transition is allowed
      const allowedTransitions: string[] = Array.isArray(os.module_statuses?.transitions)
        ? os.module_statuses!.transitions as string[]
        : []
      if (allowedTransitions.length > 0 && !allowedTransitions.includes(targetStatus.id)) {
        return botError(`Transicao de "${statusAnterior}" para "${targetStatus.name}" nao permitida`)
      }

      // Block transition from final status
      if (os.module_statuses?.is_final) {
        return botError(`OS esta em status final "${statusAnterior}". Nao pode ser alterada.`)
      }

      updateData.status_id = targetStatus.id
      newStatusId = targetStatus.id
      statusAtual = targetStatus.name
      camposAtualizados.push('status')

      // Se Aprovado, calcular previsão de 10 dias úteis
      if (targetStatus.name.toLowerCase().includes('aprovad')) {
        const est = new Date()
        let du = 0
        while (du < 10) { est.setDate(est.getDate() + 1); const d = est.getDay(); if (d !== 0 && d !== 6) du++ }
        updateData.estimated_delivery = est
        camposAtualizados.push('previsao_entrega')
      }
    }

    if (diagnostico !== undefined) {
      updateData.diagnosis = diagnostico
      camposAtualizados.push('diagnostico')
    }

    if (observacoes !== undefined) {
      const prefix = `[BOT ${now}] `
      updateData.reception_notes = os.reception_notes
        ? os.reception_notes + '\n' + prefix + observacoes
        : prefix + observacoes
      camposAtualizados.push('observacoes')
    }

    if (notas_internas !== undefined) {
      const prefix = `[BOT ${now}] `
      updateData.internal_notes = os.internal_notes
        ? os.internal_notes + '\n' + prefix + notas_internas
        : prefix + notas_internas
      camposAtualizados.push('notas_internas')
    }

    if (custo_estimado !== undefined) {
      updateData.estimated_cost = parseInt(String(custo_estimado), 10) || 0
      camposAtualizados.push('custo_estimado')
    }

    if (previsao_entrega !== undefined) {
      updateData.estimated_delivery = previsao_entrega ? new Date(previsao_entrega) : null
      camposAtualizados.push('previsao_entrega')
    }

    if (camposAtualizados.length === 0) return botError('Nenhum campo para atualizar')

    // Update OS
    await prisma.serviceOrder.update({
      where: { id: os.id },
      data: updateData,
    })

    // Create history entry if status changed
    if (newStatusId) {
      await prisma.serviceOrderHistory.create({
        data: {
          company_id: companyId,
          service_order_id: os.id,
          from_status_id: os.status_id,
          to_status_id: newStatusId,
          changed_by: 'BOT_ANA',
          notes: `Status alterado via Bot Ana: ${statusAnterior} → ${statusAtual}`,
        },
      })
    }

    console.log(`[Bot atualizar-os] OS #${osNumber} | Campos: ${camposAtualizados.join(', ')}`)

    return botSuccess({
      os_numero: osNumber,
      os_id: os.id,
      status_anterior: statusAnterior,
      status_atual: statusAtual,
      campos_atualizados: camposAtualizados,
      mensagem: `OS ${osNumber} atualizada: ${camposAtualizados.join(', ')}`,
    })
  } catch (err: any) {
    console.error('[Bot atualizar-os]', err.message)
    return botError('Erro interno', 500)
  }
}
