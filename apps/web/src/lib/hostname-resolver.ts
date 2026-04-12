import { prisma } from '@pontual/db'

interface CompanyHost {
  id: string
  slug: string
  name: string
}

// In-memory cache: hostname → company (TTL 60s)
const cache = new Map<string, { data: CompanyHost | null; expires: number }>()
const CACHE_TTL = 60_000

// Base domain for subdomains (e.g., erp.pontualtech.work)
const ERP_BASE_DOMAIN = process.env.ERP_BASE_DOMAIN || 'erp.pontualtech.work'

/**
 * Extract subdomain from hostname.
 * "techfix.erp.pontualtech.work" → "techfix"
 * "erp.pontualtech.work" → null (main domain)
 * "localhost:3333" → null
 */
function extractSubdomain(hostname: string): string | null {
  // Remove port
  const host = hostname.split(':')[0]

  // Check if it's a subdomain of the base domain
  if (host.endsWith(`.${ERP_BASE_DOMAIN}`)) {
    const sub = host.slice(0, -(ERP_BASE_DOMAIN.length + 1))
    // Only single-level subdomains (no dots)
    if (sub && !sub.includes('.')) return sub
  }

  return null
}

/**
 * Resolve hostname to company.
 * Checks: subdomain match → custom_domain match → null
 */
export async function resolveHostname(hostname: string): Promise<CompanyHost | null> {
  // Check cache first
  // Reject obviously invalid hostnames
  if (!hostname || hostname.length > 253 || /[^a-zA-Z0-9.\-:]/.test(hostname)) return null

  const cached = cache.get(hostname)
  if (cached && cached.expires > Date.now()) return cached.data

  let company: CompanyHost | null = null

  // 1. Try subdomain
  const sub = extractSubdomain(hostname)
  if (sub) {
    const row = await prisma.company.findFirst({
      where: { subdomain: sub, is_active: true },
      select: { id: true, slug: true, name: true },
    })
    if (row) company = row
  }

  // 2. Try custom domain (full hostname without port)
  if (!company) {
    const host = hostname.split(':')[0]
    // Skip base domain and localhost
    if (host !== ERP_BASE_DOMAIN && host !== 'localhost') {
      const row = await prisma.company.findFirst({
        where: { custom_domain: host, is_active: true },
        select: { id: true, slug: true, name: true },
      })
      if (row) company = row
    }
  }

  // Cache result (even null, to avoid repeated DB hits for unknown hosts)
  cache.set(hostname, { data: company, expires: Date.now() + CACHE_TTL })

  return company
}

/**
 * Clear cache for a specific hostname or all.
 * Call this when admin updates domain config.
 */
export function clearHostnameCache(hostname?: string) {
  if (hostname) {
    cache.delete(hostname)
  } else {
    cache.clear()
  }
}

/**
 * Check if hostname is the main/admin domain (no company context).
 */
export function isMainDomain(hostname: string): boolean {
  const host = hostname.split(':')[0]
  return host === ERP_BASE_DOMAIN || host === 'localhost' || host === '127.0.0.1'
}
