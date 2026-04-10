import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import {
  extractCertificate, signXml, sendSoapRequest, extractSoapBody,
  getSefazEndpoints, getUfCodigo,
} from '@/lib/nfe/sefaz'

/**
 * POST /api/fiscal/nfe-cce — Carta de Correção Eletrônica
 * Body: { invoice_id: string, correcao: string }
 */
export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('fiscal', 'create')
    if (result instanceof NextResponse) return result
    const user = result

    const { invoice_id, correcao } = await req.json()
    if (!invoice_id) return error('invoice_id obrigatório', 400)
    if (!correcao || correcao.length < 15) return error('Correção deve ter no mínimo 15 caracteres', 400)

    const invoice = await prisma.invoice.findFirst({
      where: { id: invoice_id, company_id: user.companyId, invoice_type: 'NFE', status: 'AUTHORIZED' },
    })
    if (!invoice) return error('NF-e não encontrada ou não autorizada', 404)
    if (!invoice.access_key) return error('NF-e sem chave de acesso', 400)

    // Contar CCe anteriores para sequencial
    const prevEvents = await prisma.$queryRawUnsafe(
      `SELECT count(*) as c FROM nfe_events WHERE invoice_id = $1 AND event_type = 'CCE' AND status = 'SUCCESS'`,
      invoice.id
    ) as any[]
    const nSeqEvento = String(Number(prevEvents[0]?.c || 0) + 1)

    // Certificado
    const fiscalCfg = await prisma.fiscalConfig.findUnique({ where: { company_id: user.companyId } })
    const fiscalSettings = (fiscalCfg?.settings || {}) as Record<string, any>
    let certPassword = ''
    if (fiscalSettings.certificate_password) {
      const { decrypt } = await import('@/lib/encryption')
      certPassword = decrypt(fiscalSettings.certificate_password)
    }
    const cert = extractCertificate(fiscalSettings.certificate_base64, certPassword)

    const settings = await prisma.setting.findMany({ where: { company_id: user.companyId } })
    const cfg: Record<string, string> = {}
    for (const s of settings) cfg[s.key] = s.value
    const uf = cfg['cnab.uf'] || 'SP'
    const cnpj = (cfg['cnab.cnpj'] || cert.cnpj || '').padStart(14, '0')
    const ambiente = fiscalCfg?.environment === 'producao' ? '1' : '2'
    const cUF = getUfCodigo(uf)

    const dhEvento = new Date().toISOString().replace(/\.\d{3}Z$/, '-03:00')
    const tpEvento = '110110' // CCe
    const idEvento = `ID${tpEvento}${invoice.access_key}${nSeqEvento.padStart(2, '0')}`

    const eventoXml = `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
      <infEvento Id="${idEvento}">
        <cOrgao>${cUF}</cOrgao>
        <tpAmb>${ambiente}</tpAmb>
        <CNPJ>${cnpj}</CNPJ>
        <chNFe>${invoice.access_key}</chNFe>
        <dhEvento>${dhEvento}</dhEvento>
        <tpEvento>${tpEvento}</tpEvento>
        <nSeqEvento>${nSeqEvento}</nSeqEvento>
        <verEvento>1.00</verEvento>
        <detEvento versao="1.00">
          <descEvento>Carta de Correcao</descEvento>
          <xCorrecao>${correcao}</xCorrecao>
          <xCondUso>A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do Convenio S/N, de 15 de dezembro de 1970 e pode ser utilizada para regularizacao de erro ocorrido na emissao de documento fiscal, desde que o erro nao esteja relacionado com: I - as variaveis que determinam o valor do imposto tais como: base de calculo, aliquota, diferenca de preco, quantidade, valor da operacao ou da prestacao; II - a correcao de dados cadastrais que implique mudanca do remetente ou do destinatario; III - a data de emissao ou de saida.</xCondUso>
        </detEvento>
      </infEvento>
    </evento>`

    const signedEvento = signXml(eventoXml, cert.privateKeyPem, cert.certificatePem, 'infEvento')
    const envEvento = `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
      <idLote>${Date.now()}</idLote>
      ${signedEvento}
    </envEvento>`

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
    const aceito = cStat === '135'

    await prisma.$executeRawUnsafe(`
      INSERT INTO nfe_events (company_id, invoice_id, event_type, seq_number, protocol, description, response_data, status)
      VALUES ($1, $2, 'CCE', $3, $4, $5, $6, $7)
    `, user.companyId, invoice.id, parseInt(nSeqEvento), nProt, correcao, JSON.stringify({ cStat, xMotivo }), aceito ? 'SUCCESS' : 'REJECTED')

    return success({ aceito, cStat, motivo: xMotivo, protocolo: nProt, sequencial: nSeqEvento })
  } catch (err) {
    return handleError(err)
  }
}
