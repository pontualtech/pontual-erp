import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { error, handleError } from '@/lib/api-response'

type Params = { params: { id: string } }

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const result = await requirePermission('fiscal', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const invoice = await prisma.invoice.findFirst({
      where: { id: params.id, company_id: user.companyId },
      include: {
        invoice_items: true,
        customers: true,
      },
    })

    if (!invoice) return error('NF-e nao encontrada', 404)

    // Auditoria 03/09 (NF 211): servir SOMENTE o nfeProc completo persistido na
    // emissao (invoice.xml_content = NFe assinada + protNFe). Os fallbacks antigos
    // eram perigosos: o log de debug guarda o XML TRUNCADO em 4000c e o "XML
    // basico" era um documento FABRICADO sem assinatura/protocolo que parecia
    // oficial — sem valor fiscal. Melhor um 404 honesto do que entregar isso.
    if (invoice.xml_content) {
      return new NextResponse(invoice.xml_content, {
        status: 200,
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Content-Disposition': `attachment; filename="NFe_${invoice.access_key || invoice.invoice_number}.xml"`,
        },
      })
    }

    return error(
      'XML autorizado nao disponivel para esta NF-e (emitida antes do fix de persistencia de 03/09/2026). O documento pode ser recuperado via consulta na SEFAZ com o certificado A1.',
      404
    )
  } catch (err) {
    return handleError(err)
  }
}
