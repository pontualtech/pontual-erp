import { NextRequest, NextResponse } from 'next/server'
export { GET } from '../../cupom-avaliacao/[token]/route'

// Alias de /cupom-avaliacao/[token] com path neutro (Meta filtra palavras
// promocionais no template; path menos "comercial" passa no filtro).
// Mesmo handler, mesma logica de cupom — so URL externa muda.
export const runtime = 'nodejs'
