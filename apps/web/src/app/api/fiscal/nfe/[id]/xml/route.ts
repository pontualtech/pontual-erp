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

    // Check if we have the XML stored in fiscal_logs
    const xmlLog = await prisma.fiscalLog.findFirst({
      where: {
        company_id: user.companyId,
        invoice_id: invoice.id,
        action: 'nfe_xml_debug',
      },
      orderBy: { created_at: 'desc' },
    })

    const rawXml = (xmlLog?.request as any)?.signed_xml || (xmlLog?.request as any)?.raw_xml || null

    if (rawXml) {
      // Return stored XML
      const xmlContent = `<?xml version="1.0" encoding="utf-8"?>\n${rawXml}`
      return new NextResponse(xmlContent, {
        status: 200,
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Content-Disposition': `attachment; filename="NFe_${invoice.access_key || invoice.invoice_number}.xml"`,
        },
      })
    }

    // Fallback: generate basic XML from invoice data
    const chave = invoice.access_key || ''
    const items = invoice.invoice_items || []
    const c = invoice.customers

    const xmlItems = items.map((item, i) =>
      `<det nItem="${i + 1}"><prod><xProd>${item.description || ''}</xProd><NCM>${item.ncm || ''}</NCM><CFOP>${item.cfop || ''}</CFOP><uCom>${item.unidade || 'UN'}</uCom><qCom>${item.quantity}</qCom><vUnCom>${((item.unit_price || 0) / 100).toFixed(2)}</vUnCom><vProd>${((item.total_price || 0) / 100).toFixed(2)}</vProd></prod></det>`
    ).join('')

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
<infNFe versao="4.00" Id="NFe${chave}">
<ide><nNF>${invoice.invoice_number}</nNF><serie>${invoice.series || '1'}</serie></ide>
<dest><xNome>${c?.legal_name || ''}</xNome></dest>
${xmlItems}
<total><ICMSTot><vNF>${((invoice.total_amount || 0) / 100).toFixed(2)}</vNF></ICMSTot></total>
</infNFe>
</NFe>
<protNFe versao="4.00"><infProt><chNFe>${chave}</chNFe></infProt></protNFe>
</nfeProc>`

    return new NextResponse(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="NFe_${chave || invoice.invoice_number}.xml"`,
      },
    })
  } catch (err) {
    return handleError(err)
  }
}
