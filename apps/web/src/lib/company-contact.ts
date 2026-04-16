import { prisma } from '@pontual/db'

/**
 * Load company contact/branding data from DB settings.
 * NEVER hardcode company-specific data — always use this function.
 * Multi-tenant: each company has its own settings in the DB.
 */

// Cache per company (5 min TTL)
const cache = new Map<string, { data: CompanyContact; expires: number }>()

export interface CompanyContact {
  name: string
  phone: string
  whatsapp: string
  whatsappUrl: string
  email: string
  cnpj: string
  address: string
  website: string
  portalBaseUrl: string
  horario: string
}

export async function getCompanyContact(companyId: string): Promise<CompanyContact> {
  const cached = cache.get(companyId)
  if (cached && cached.expires > Date.now()) return cached.data

  const settings = await prisma.setting.findMany({
    where: { company_id: companyId },
  })
  const get = (key: string) => settings.find(s => s.key === key)?.value || ''

  // Load company name from settings first, then from company table
  let name = get('company.name')
  if (!name) {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, slug: true },
    })
    name = company?.name || 'Empresa'
  }

  const whatsapp = (get('company.whatsapp') || get('whatsapp')).replace(/\D/g, '')
  const portalDomain = get('portal.domain')
  const portalBaseUrl = portalDomain
    ? `https://${portalDomain}`
    : (process.env.PORTAL_URL || '')

  const data: CompanyContact = {
    name,
    phone: get('company.phone') || get('telefone'),
    whatsapp,
    whatsappUrl: whatsapp ? `https://wa.me/${whatsapp}` : '',
    email: get('company.email') || get('email'),
    cnpj: get('company.cnpj') || get('cnpj') || get('cnab.cnpj'),
    address: get('company.address') || get('endereco') ||
      [get('cnab.endereco'), get('company.number'), get('cnab.bairro'), get('cnab.cidade'), get('cnab.uf')].filter(Boolean).join(', '),
    website: get('company.website') || get('website'),
    portalBaseUrl,
    horario: get('company.horario') || 'Seg a Qui 08:00-18:00 | Sex 08:00-17:00',
  }

  cache.set(companyId, { data, expires: Date.now() + 5 * 60 * 1000 })
  return data
}
