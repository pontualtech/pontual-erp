import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { authenticateBot } from '../../_lib/auth'
import { botSuccess, botError } from '../../_lib/response'

/**
 * PATCH /api/bot/cliente/atualizar
 *
 * Tool do Dify "atualizar_cadastro_cliente" — atualiza email ou telefone
 * do cliente identificado por numero_os ou CPF/CNPJ.
 * Multi-tenant: valida company_id via X-Bot-Key.
 *
 * Body: { numero_os?: string, cpf?: string, campo: "email"|"telefone", novo_valor: string }
 */
export async function PATCH(req: NextRequest) {
  try {
    const auth = authenticateBot(req)
    if (auth instanceof NextResponse) return auth

    const body = await req.json().catch(() => ({}))
    const { numero_os, cpf, campo, novo_valor } = body

    if (!campo || !novo_valor) {
      return botError('Campos "campo" e "novo_valor" sao obrigatorios')
    }

    if (campo !== 'email' && campo !== 'telefone') {
      return botError('Campo deve ser "email" ou "telefone"')
    }

    // Validate the new value
    if (campo === 'email') {
      if (!novo_valor.includes('@') || !novo_valor.includes('.')) {
        return botSuccess({
          sucesso: false,
          mensagem: 'O email informado parece invalido. Verifique e tente novamente.',
        })
      }
    }

    if (campo === 'telefone') {
      const phoneDigits = novo_valor.replace(/\D/g, '')
      if (phoneDigits.length < 10 || phoneDigits.length > 13) {
        return botSuccess({
          sucesso: false,
          mensagem: 'O telefone informado parece invalido. Informe com DDD (ex: 11999887766).',
        })
      }
    }

    // Find the customer — by OS number or CPF/CNPJ
    let customer = null

    if (numero_os) {
      const osNum = parseInt(numero_os, 10)
      if (osNum < 60000) {
        return botSuccess({
          sucesso: false,
          mensagem: 'Atualizacao de cadastro nao disponivel para OS do sistema legado. Um atendente pode atualizar para voce.',
        })
      }
      const os = await prisma.serviceOrder.findFirst({
        where: { os_number: osNum, company_id: auth.companyId, deleted_at: null },
        select: { customer_id: true },
      })
      if (os?.customer_id) {
        customer = await prisma.customer.findFirst({
          where: { id: os.customer_id, company_id: auth.companyId, deleted_at: null },
        })
      }
    } else if (cpf) {
      const digits = cpf.replace(/\D/g, '')
      customer = await prisma.customer.findFirst({
        where: { company_id: auth.companyId, document_number: digits, deleted_at: null },
      })
    }

    if (!customer) {
      return botSuccess({
        sucesso: false,
        mensagem: 'Cliente nao encontrado. Verifique o numero da OS ou CPF/CNPJ.',
      })
    }

    // Build update data
    const updateData: any = {}
    const oldValue = campo === 'email' ? customer.email : (customer.mobile || customer.phone)

    if (campo === 'email') {
      updateData.email = novo_valor.trim().toLowerCase()
    } else {
      const phoneDigits = novo_valor.replace(/\D/g, '')
      updateData.mobile = phoneDigits.startsWith('55') ? phoneDigits : phoneDigits
    }

    // Save audit trail in custom_data
    const customData = (customer.custom_data || {}) as Record<string, any>
    const auditLog = customData.audit_log || []
    auditLog.push({
      campo,
      de: oldValue || null,
      para: campo === 'email' ? updateData.email : updateData.mobile,
      quando: new Date().toISOString(),
      por: 'BOT_MARTA',
    })
    // Keep only last 20 audit entries
    updateData.custom_data = { ...customData, audit_log: auditLog.slice(-20) }

    // Execute update
    await prisma.customer.update({
      where: { id: customer.id, company_id: auth.companyId },
      data: updateData,
    })

    const campoLabel = campo === 'email' ? 'Email' : 'Telefone'
    const valorFormatado = campo === 'email' ? updateData.email : updateData.mobile

    return botSuccess({
      sucesso: true,
      mensagem: `${campoLabel} atualizado com sucesso para: ${valorFormatado}`,
      cliente_id: customer.id,
      cliente_nome: customer.legal_name,
      campo_atualizado: campo,
      valor_anterior: oldValue || '(vazio)',
      valor_novo: valorFormatado,
    })
  } catch (err: any) {
    console.error('[Bot cliente/atualizar]', err.message)
    return botError('Erro interno ao atualizar cadastro', 500)
  }
}
