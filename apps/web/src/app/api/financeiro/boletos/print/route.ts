import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'

/**
 * GET /api/financeiro/boletos/print?ids=id1,id2,...
 * Retorna dados completos dos boletos para impressao (cedente + sacado + metadata)
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission('financeiro', 'view')
    if (auth instanceof NextResponse) return auth
    const user = auth

    const ids = req.nextUrl.searchParams.get('ids')?.split(',').filter(Boolean)
    if (!ids?.length) {
      return NextResponse.json({ error: 'Informe os IDs dos boletos (ids=id1,id2)' }, { status: 400 })
    }

    // Buscar boletos com cliente
    const receivables = await prisma.accountReceivable.findMany({
      where: {
        id: { in: ids },
        company_id: user.companyId,
        deleted_at: null,
      },
      include: {
        customers: {
          select: {
            legal_name: true,
            document_number: true,
            email: true,
            address_street: true,
            address_number: true,
            address_neighborhood: true,
            address_city: true,
            address_state: true,
            address_zip: true,
          },
        },
      },
      orderBy: { due_date: 'asc' },
    })

    if (receivables.length === 0) {
      return NextResponse.json({ error: 'Nenhum boleto encontrado' }, { status: 404 })
    }

    // Buscar config do cedente
    const settings = await prisma.setting.findMany({
      where: {
        company_id: user.companyId,
        key: { in: ['cnab.cnpj', 'cnab.razao_social', 'cnab.agencia', 'cnab.conta', 'cnab.carteira'] },
      },
    })
    const cfg: Record<string, string> = {}
    for (const s of settings) cfg[s.key] = s.value

    const company = await prisma.company.findUnique({
      where: { id: user.companyId },
      select: { name: true },
    })

    const data = receivables.map(r => {
      let meta: any = {}
      try { if (r.pix_code) meta = JSON.parse(r.pix_code) } catch {}

      const enderecoParts = [
        r.customers?.address_street,
        r.customers?.address_number,
        r.customers?.address_neighborhood,
      ].filter(Boolean)

      return {
        id: r.id,
        description: r.description,
        amount: r.total_amount,
        dueDate: r.due_date,
        status: r.status,
        nossoNumero: meta.nossoNumero || '',
        barcode: meta.barcode || '',
        digitableLine: meta.digitableLine || '',
        pixCode: meta.pixCode || null,
        boletoUrl: r.boleto_url,
        // Cedente
        cedenteNome: cfg['cnab.razao_social'] || company?.name || '',
        cedenteCnpj: cfg['cnab.cnpj'] || '',
        cedenteAgencia: cfg['cnab.agencia'] || '0001',
        cedenteConta: cfg['cnab.conta'] || '',
        cedenteCarteira: cfg['cnab.carteira'] || '112',
        // Sacado
        customerName: r.customers?.legal_name || '',
        customerDocument: r.customers?.document_number || '',
        customerEndereco: enderecoParts.join(', '),
        customerCidade: r.customers?.address_city || '',
        customerUf: r.customers?.address_state || '',
        customerCep: r.customers?.address_zip || '',
        customerEmail: r.customers?.email || '',
        // Instrucoes
        multa: meta.multa || '2,00%',
        juros: meta.juros || '1,00%',
        mensagem: r.description || '',
      }
    })

    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
