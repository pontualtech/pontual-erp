import { NextResponse } from 'next/server'
import { ZodError } from 'zod'

export function success<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status })
}

export function paginated<T>(data: T[], total: number, page: number, limit: number) {
  return NextResponse.json({
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  })
}

export function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export function handleError(err: unknown) {
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: 'Dados inválidos', details: err.errors },
      { status: 422 }
    )
  }

  // Prisma unique violation (P2002): mostra mensagem útil em vez de 500 genérico.
  // Caso real 2026-05-12: cliente duplicado com mesmo CPF na partial unique
  // (company_id, document_number) → "Erro interno do servidor" mascarava a causa.
  if (err && typeof err === 'object' && (err as any).code === 'P2002') {
    const target = (err as any).meta?.target
    const fields: string[] = Array.isArray(target) ? target : (typeof target === 'string' ? [target] : [])
    const isDoc = fields.some(f => f.includes('document'))
    const message = isDoc
      ? 'Já existe outro cadastro com esse CPF/CNPJ.'
      : `Já existe um registro com esse valor${fields.length ? ` (${fields.join(', ')})` : ''}.`
    return NextResponse.json({ error: message }, { status: 409 })
  }

  if (err instanceof Error) {
    console.error('[API Error]', err.stack || err.message)
    // Em produção, não expor detalhes do erro interno
    const message = process.env.NODE_ENV === 'production'
      ? 'Erro interno do servidor'
      : err.message
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }

  return NextResponse.json(
    { error: 'Erro interno do servidor' },
    { status: 500 }
  )
}
