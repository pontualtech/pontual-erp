import { prisma } from '@pontual/db'

// Piso de OS "nova" (não-legada) por empresa. Substitui o hardcode `60000`
// (regra da PontualTech) que rejeitava TODA OS da Imprimitech (começa em 6000).
// Fonte: setting `bot.config.new_os_min`; fallback pelo slug. Ver auditoria 27/06.

export function resolveNewOsMin(
  settingValue: string | null | undefined,
  companySlug: string | null | undefined,
): number {
  if (settingValue) {
    const n = parseInt(settingValue, 10)
    if (Number.isFinite(n)) return n
  }
  return (companySlug || '').includes('imprimitech') ? 6000 : 60000
}

// Resolve o piso por company_id (carrega slug + setting). Usado pelas rotas de
// bot (/api/bot/*) que só têm companyId via X-Bot-Key.
export async function getNewOsMin(companyId: string): Promise<number> {
  const [company, setting] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { slug: true } }).catch(() => null),
    prisma.setting.findFirst({
      where: { company_id: companyId, key: 'bot.config.new_os_min' },
      select: { value: true },
    }).catch(() => null),
  ])
  return resolveNewOsMin(setting?.value, company?.slug)
}
