import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import {
  extractCertificate, sendSoapRequest, extractSoapBody,
  getSefazEndpoints,
} from '@/lib/nfe/sefaz'

/**
 * GET /api/fiscal/nfe-status — Consultar status do serviço SEFAZ
 */
export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('fiscal', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const fiscalCfg = await prisma.fiscalConfig.findUnique({ where: { company_id: user.companyId } })
    if (!fiscalCfg) return error('Config fiscal não encontrada', 400)
    const fiscalSettings = (fiscalCfg.settings || {}) as Record<string, any>

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
    const ambiente = fiscalCfg.environment === 'producao' ? '1' : '2'

    const endpoints = getSefazEndpoints(uf, ambiente as '1' | '2')

    const consStatusXml = `<consStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
      <tpAmb>${ambiente}</tpAmb>
      <cUF>35</cUF>
      <xServ>STATUS</xServ>
    </consStatServ>`

    const sefazResponse = await sendSoapRequest({
      url: endpoints.statusServico,
      action: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4/nfeStatusServicoNF',
      body: consStatusXml,
      privateKeyPem: cert.privateKeyPem,
      certificatePem: cert.certificatePem,
      timeout: 10000,
    })

    const body = extractSoapBody(sefazResponse)
    const cStat = body.match(/<cStat>(\d+)<\/cStat>/)?.[1] || ''
    const xMotivo = body.match(/<xMotivo>([^<]+)<\/xMotivo>/)?.[1] || ''
    const tMed = body.match(/<tMed>(\d+)<\/tMed>/)?.[1] || ''

    return success({
      online: cStat === '107',
      cStat,
      motivo: xMotivo,
      tempoMedio: tMed ? parseInt(tMed) : null,
      ambiente: ambiente === '1' ? 'Produção' : 'Homologação',
      uf,
    })
  } catch (err) {
    return handleError(err)
  }
}
