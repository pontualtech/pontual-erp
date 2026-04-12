import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { resolveHostname, isMainDomain } from '@/lib/hostname-resolver'

// GET /api/auth/company-from-host — Resolve current hostname to company
// Used by the login page to show company branding and auto-select
export async function GET() {
  try {
    const headersList = headers()
    const hostname = headersList.get('host') || ''

    if (isMainDomain(hostname)) {
      return NextResponse.json({ data: null, isMainDomain: true })
    }

    const company = await resolveHostname(hostname)

    if (!company) {
      return NextResponse.json({ data: null, isMainDomain: false })
    }

    return NextResponse.json({
      data: {
        slug: company.slug,
        name: company.name,
      },
      isMainDomain: false,
    })
  } catch {
    return NextResponse.json({ data: null, isMainDomain: true })
  }
}
