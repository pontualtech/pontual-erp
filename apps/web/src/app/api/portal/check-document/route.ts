import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { rateLimit } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  const startedAt = Date.now()
  try {
    const rl = rateLimit(`check-doc:${req.ip || 'unknown'}`, 10, 60 * 1000) // 10 per minute
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Muitas tentativas' }, { status: 429 })
    }

    const { document, company_slug } = await req.json()

    if (!document || !company_slug) {
      return NextResponse.json({ error: 'Documento e empresa obrigatorios' }, { status: 400 })
    }

    const cleanDoc = document.replace(/\D/g, '')
    if (cleanDoc.length !== 11 && cleanDoc.length !== 14) {
      return NextResponse.json({ error: 'CPF ou CNPJ invalido' }, { status: 400 })
    }

    const company = await prisma.company.findUnique({
      where: { slug: company_slug },
    })

    if (!company) {
      return NextResponse.json({ error: 'Empresa nao encontrada' }, { status: 404 })
    }

    // Check if customer exists in ERP
    const customer = await prisma.customer.findFirst({
      where: {
        company_id: company.id,
        document_number: cleanDoc,
        deleted_at: null,
      },
      select: {
        id: true,
        legal_name: true,
        email: true,
      },
    })

    // N10 mitigação (audit pos-fix): timing constant pra evitar oracle
    // (atacante mede latência pra distinguir "encontrou" vs "não encontrou").
    // Não fechamos a enumeration completamente porque UX precisa distinguir
    // pra mostrar fluxo de registro vs login — mas adicionamos audit + delay.
    const respondInConstantTime = async (data: any, status = 200) => {
      const elapsed = Date.now() - startedAt
      const target = 350 // ms — delay constante pra resposta
      if (elapsed < target) await new Promise(r => setTimeout(r, target - elapsed))
      return NextResponse.json({ data }, { status })
    }

    if (!customer) {
      // Audit lookup tentativa pra detecção de enumeration em volume
      try {
        await prisma.auditLog.create({
          data: {
            company_id: company.id,
            user_id: 'system:portal-check-doc',
            module: 'portal',
            action: 'doc_lookup_not_found',
            ip_address: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
            new_value: { doc_hash_prefix: cleanDoc.slice(0, 4) + '***' },
          },
        })
      } catch {}
      return respondInConstantTime({ exists: false, has_access: false })
    }

    // Customer exists — check if has portal access
    const access = await prisma.customerAccess.findUnique({
      where: {
        company_id_customer_id: {
          company_id: company.id,
          customer_id: customer.id,
        },
      },
      select: { id: true, email_verified: true },
    })

    // Mask email for hint
    const emailHint = customer.email
      ? customer.email.replace(/^(.{2}).*(@.*)$/, '$1***$2')
      : null

    return respondInConstantTime({
      exists: true,
      has_access: !!access,
      email_verified: access?.email_verified || false,
      customer_name: customer.legal_name?.split(' ')[0] || 'Cliente',
      email_hint: emailHint,
    })
  } catch (err) {
    console.error('[Portal Check Document Error]', err)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
