import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'

/**
 * GET /s/[slug]
 *
 * URL shortener handler. Lookup do slug → 302 redirect pro target_url.
 * Increment click_count + last_clicked_at pra analytics.
 *
 * Comportamento se invalido/expirado: 302 pro portal home (nao 404)
 * — cliente confuso e melhor cair em pagina valida do que ver erro.
 */
export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const slug = params.slug

  // Slug malformado (nosso e [a-zA-Z0-9]{7}) → fallback portal home
  if (!slug || !/^[a-zA-Z0-9]+$/.test(slug)) {
    return NextResponse.redirect('https://portal.pontualtech.com.br/portal/pontualtech/login', 302)
  }

  const link = await prisma.shortLink.findUnique({
    where: { slug },
    select: { id: true, target_url: true, expires_at: true, company_id: true },
  })

  if (!link) {
    // Slug nao existe — talvez expirou e foi limpo OU nunca existiu
    return NextResponse.redirect('https://portal.pontualtech.com.br/portal/pontualtech/login', 302)
  }

  if (link.expires_at && link.expires_at < new Date()) {
    return NextResponse.redirect('https://portal.pontualtech.com.br/portal/pontualtech/login', 302)
  }

  // Increment analytics fire-and-forget (nao bloqueia redirect)
  prisma.shortLink.update({
    where: { id: link.id },
    data: {
      click_count: { increment: 1 },
      last_clicked_at: new Date(),
    },
  }).catch(err => console.warn('[short-link] analytics update failed:', err instanceof Error ? err.message : err))

  return NextResponse.redirect(link.target_url, 302)
}
