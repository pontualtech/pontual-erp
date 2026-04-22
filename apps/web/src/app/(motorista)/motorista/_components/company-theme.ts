/**
 * Tema visual do app do motorista por empresa.
 * Diferencia PontualTech (azul-roxo) de Imprimitech (laranja-preto)
 * e de outras empresas (default indigo).
 *
 * Retorna classes Tailwind pra usar diretamente no JSX.
 */

export type CompanyTheme = {
  brandName: string
  tagline: string
  // header principal (gradient bg + text color)
  headerBg: string
  headerAccent: string
  // badges de COLETA e ENTREGA
  coletaBg: string
  coletaBgHero: string
  entregaBg: string
  entregaBgHero: string
  // cor primary (botoes de CTA)
  primaryBg: string
  primaryHover: string
  // destaque do "Proxima parada" e ring
  nextRing: string
  nextLabel: string
}

const themes: Record<string, CompanyTheme> = {
  pontualtech: {
    brandName: 'PontualTech',
    tagline: 'Assistencia Tecnica',
    headerBg: 'bg-gradient-to-r from-blue-700 to-indigo-700 text-white',
    headerAccent: 'text-blue-100',
    coletaBg: 'bg-purple-100 text-purple-700',
    coletaBgHero: 'bg-purple-600 text-white',
    entregaBg: 'bg-emerald-100 text-emerald-700',
    entregaBgHero: 'bg-emerald-600 text-white',
    primaryBg: 'bg-blue-600',
    primaryHover: 'hover:bg-blue-700',
    nextRing: 'border-blue-200',
    nextLabel: 'text-blue-600',
  },
  imprimitech: {
    brandName: 'Imprimitech',
    tagline: 'Tecnologia em Impressao',
    headerBg: 'bg-gradient-to-r from-orange-600 to-red-600 text-white',
    headerAccent: 'text-orange-100',
    coletaBg: 'bg-amber-100 text-amber-800',
    coletaBgHero: 'bg-amber-600 text-white',
    entregaBg: 'bg-teal-100 text-teal-800',
    entregaBgHero: 'bg-teal-600 text-white',
    primaryBg: 'bg-orange-600',
    primaryHover: 'hover:bg-orange-700',
    nextRing: 'border-orange-200',
    nextLabel: 'text-orange-600',
  },
}

const defaultTheme: CompanyTheme = themes.pontualtech

export function getCompanyTheme(slug: string | null | undefined): CompanyTheme {
  if (!slug) return defaultTheme
  return themes[slug.toLowerCase()] || defaultTheme
}
