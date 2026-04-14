import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'

export async function GET(req: NextRequest) {
  try {
    const slug = req.nextUrl.searchParams.get('slug')

    if (!slug) {
      return NextResponse.json({ error: 'Slug e obrigatorio' }, { status: 400 })
    }

    const company = await prisma.company.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,
        logo: true,
      },
    })

    if (!company) {
      return NextResponse.json({ error: 'Empresa nao encontrada' }, { status: 404 })
    }

    // Load company settings for portal display (contact, payment, hours)
    const settings = await prisma.setting.findMany({
      where: { company_id: company.id },
      select: { key: true, value: true },
    })
    const cfg: Record<string, string> = {}
    for (const s of settings) cfg[s.key] = s.value

    return NextResponse.json({
      data: {
        ...company,
        phone: cfg['company.phone'] || '',
        whatsapp: cfg['company.whatsapp'] || '',
        email: cfg['company.email'] || '',
        address: [cfg['cnab.endereco'], cfg['company.number'], cfg['cnab.bairro'], cfg['cnab.cidade'], cfg['cnab.uf']].filter(Boolean).join(', '),
        cep: cfg['cnab.cep'] || '',
        cnpj: cfg['cnab.cnpj'] || '',
        horario: cfg['company.horario'] || 'Seg a Qui 08:00-18:00 | Sex 08:00-17:00',
        pix_chave: cfg['pix.chave'] || cfg['cnab.cnpj'] || '',
        pix_banco: cfg['pix.banco'] || '',
        default_business_days: cfg['os.default_business_days'] || '10',
      },
    })
  } catch (err) {
    console.error('[Portal Company Error]', err)
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 })
  }
}
