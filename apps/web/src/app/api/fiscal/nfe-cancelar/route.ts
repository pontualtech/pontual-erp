import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import {
  extractCertificate, signXml, sendSoapRequest, extractSoapBody,
  getSefazEndpoints, getUfCodigo,
} from '@/lib/nfe/sefaz'

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/**
 * POST /api/fiscal/nfe-cancelar
 * Body: { invoice_id: string, justificativa: string }
 */
export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('fiscal', 'create')
    if (result instanceof NextResponse) return result
    const user = result

    const { invoice_id, justificativa } = await req.json()
    if (!invoice_id) return error('invoice_id obrigatório', 400)
    if (!justificativa || justificativa.length < 15) return error('Justificativa deve ter no mínimo 15 caracteres', 400)

    const invoice = await prisma.invoice.findFirst({
      where: { id: invoice_id, company_id: user.companyId, invoice_type: 'NFE', status: 'AUTHORIZED' },
    })
    if (!invoice) return error('NF-e não encontrada ou não está autorizada', 404)
    if (!invoice.access_key) return error('NF-e sem chave de acesso', 400)
    if (!invoice.provider_ref) return error('NF-e sem protocolo de autorização', 400)

    // Certificado
    const fiscalCfg = await prisma.fiscalConfig.findUnique({ where: { company_id: user.companyId } })
    const fiscalSettings = (fiscalCfg?.settings || {}) as Record<string, any>
    let certPassword = ''
    if (fiscalSettings.certificate_password) {
      const { decrypt } = await import('@/lib/encryption')
      certPassword = decrypt(fiscalSettings.certificate_password)
    }
    const cert = extractCertificate(fiscalSettings.certificate_base64, certPassword)

    // Settings
    const settings = await prisma.setting.findMany({ where: { company_id: user.companyId } })
    const cfg: Record<string, string> = {}
    for (const s of settings) cfg[s.key] = s.value
    const uf = cfg['cnab.uf'] || 'SP'
    const cnpj = (cfg['cnab.cnpj'] || cert.cnpj || '').padStart(14, '0')
    const ambiente = fiscalCfg?.environment === 'producao' ? '1' : '2'
    const cUF = getUfCodigo(uf)

    // Montar XML do evento de cancelamento
    const brDate = new Date(Date.now() - 3 * 60 * 60 * 1000)
    const dhEvento = brDate.toISOString().replace(/\.\d{3}Z$/, '-03:00')
    const nSeqEvento = '1'
    const tpEvento = '110111' // Cancelamento
    const idEvento = `ID${tpEvento}${invoice.access_key}${nSeqEvento.padStart(2, '0')}`

    const eventoXml = `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><infEvento Id="${idEvento}"><cOrgao>${cUF}</cOrgao><tpAmb>${ambiente}</tpAmb><CNPJ>${cnpj}</CNPJ><chNFe>${invoice.access_key}</chNFe><dhEvento>${dhEvento}</dhEvento><tpEvento>${tpEvento}</tpEvento><nSeqEvento>${nSeqEvento}</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Cancelamento</descEvento><nProt>${invoice.provider_ref}</nProt><xJust>${escapeXml(justificativa)}</xJust></detEvento></infEvento></evento>`

    const signedEvento = signXml(eventoXml, cert.privateKeyPem, cert.certificatePem, 'infEvento')

    const envEvento = `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>${Date.now()}</idLote>${signedEvento}</envEvento>`

    const endpoints = getSefazEndpoints(uf, ambiente as '1' | '2')

    const sefazResponse = await sendSoapRequest({
      url: endpoints.recepcaoEvento,
      action: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento',
      body: envEvento,
      privateKeyPem: cert.privateKeyPem,
      certificatePem: cert.certificatePem,
    })

    const responseBody = extractSoapBody(sefazResponse)
    const cStat = responseBody.match(/<cStat>(\d+)<\/cStat>/)?.[1] || ''
    const xMotivo = responseBody.match(/<xMotivo>([^<]+)<\/xMotivo>/)?.[1] || ''
    const nProt = responseBody.match(/<nProt>(\d+)<\/nProt>/)?.[1] || ''

    const cancelado = cStat === '135' || cStat === '155' // 135=cancelado, 155=cancelamento fora prazo aceito

    // Registrar evento
    await prisma.$executeRawUnsafe(`
      INSERT INTO nfe_events (company_id, invoice_id, event_type, seq_number, protocol, description, response_data, status)
      VALUES ($1, $2, 'CANCELAMENTO', 1, $3, $4, $5, $6)
    `, user.companyId, invoice.id, nProt, justificativa, JSON.stringify({ cStat, xMotivo }), cancelado ? 'SUCCESS' : 'REJECTED')

    if (cancelado) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: 'CANCELLED', cancelled_at: new Date() },
      })

      // Estornar estoque
      const invoiceItems = await prisma.invoiceItem.findMany({ where: { invoice_id: invoice.id } })
      for (const item of invoiceItems) {
        if (item.product_id) {
          await prisma.$transaction([
            prisma.stockMovement.create({
              data: {
                company_id: user.companyId,
                product_id: item.product_id,
                movement_type: 'ENTRY',
                reason: 'NF-e Cancelada (estorno)',
                quantity: item.quantity,
                reference_id: invoice.id,
                user_id: user.id,
              },
            }),
            prisma.product.update({
              where: { id: item.product_id },
              data: { current_stock: { increment: item.quantity } },
            }),
          ])
        }
      }
    }

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'fiscal',
      action: 'nfe.cancelar',
      entityId: invoice.id,
      newValue: { cStat, xMotivo, protocolo: nProt, cancelado },
    })

    return success({ cancelado, cStat, motivo: xMotivo, protocolo: nProt })
  } catch (err) {
    return handleError(err)
  }
}
