import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, handleError } from '@/lib/api-response'

/**
 * Sprint UX-29: dedup case-insensitive + acentos. Antes o dropdown mostrava
 * "Mauá" e "MAUA" como 2 opções, "Sao Paulo"/"São Paulo"/"SAO PAULO"/etc
 * como 5 opções. Agora agrupa por chave canônica (lower + sem acentos)
 * e devolve uma representante em Title Case por grupo.
 *
 * O filtro do listing usa `mode: 'insensitive'` no Prisma + `unaccent` em
 * SQL raw — ver /api/clientes/route.ts.
 */
function canonicalKey(city: string): string {
  return city
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/\s+/g, ' ')
    .trim()
}

function toTitleCase(city: string): string {
  // "SAO PAULO" -> "Sao Paulo"; "são paulo" -> "São Paulo".
  // Preserva acentos do input se houver — usamos a versão "menos UPPERCASE"
  // (Title Case parcial ainda preserva variantes naturais).
  return city
    .toLowerCase()
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('clientes', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const cities = await prisma.customer.findMany({
      where: {
        company_id: user.companyId,
        deleted_at: null,
        address_city: { not: null },
      },
      select: { address_city: true },
      distinct: ['address_city'],
      orderBy: { address_city: 'asc' },
    })

    // Sprint UX-29: dedup por chave canônica (lower + sem acentos).
    // Para cada grupo, escolhe representante: prefere a com acentos (mais legível)
    // sobre a sem acentos; em empate, mantém a primeira encontrada.
    const groups = new Map<string, string>()
    for (const c of cities) {
      const raw = c.address_city
      if (!raw) continue
      const key = canonicalKey(raw)
      if (!key) continue
      const existing = groups.get(key)
      if (!existing) {
        groups.set(key, raw)
      } else {
        // Tem acentos? (À-ſ captura acentos latinos)
        const hasDiacritics = /[À-ſ]/.test(raw)
        const existingHasDiacritics = /[À-ſ]/.test(existing)
        // Prefere com acento; em empate, prefere quem tem mais minúsculas
        // (heurística pra escolher "Mauá" em vez de "MAUA")
        if (hasDiacritics && !existingHasDiacritics) {
          groups.set(key, raw)
        } else if (hasDiacritics === existingHasDiacritics) {
          const lowerCount = (s: string) => s.match(/[a-zà-ÿ]/g)?.length ?? 0
          if (lowerCount(raw) > lowerCount(existing)) groups.set(key, raw)
        }
      }
    }

    // Converte para Title Case quando o representante está em UPPERCASE.
    // Mantém versões mistas (já com diacrítico) intactas.
    const data = Array.from(groups.values())
      .map(c => (c === c.toUpperCase() ? toTitleCase(c) : c))
      .sort((a, b) => a.localeCompare(b, 'pt-BR'))

    return success(data)
  } catch (err) {
    return handleError(err)
  }
}
