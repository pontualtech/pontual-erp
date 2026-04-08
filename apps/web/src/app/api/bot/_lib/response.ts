import { NextResponse } from 'next/server'

export function botSuccess(data: Record<string, unknown>) {
  return NextResponse.json({ ok: true, ...data })
}

export function botError(msg: string, status = 400) {
  return NextResponse.json({ ok: false, erro: msg }, { status })
}
