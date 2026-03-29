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

  if (err instanceof Error) {
    console.error('[API Error]', err.message)
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
