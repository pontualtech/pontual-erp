import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import {
  extractCertificate, sendSoapRequest, extractSoapBody,
  getSefazEndpoints, getUfCodigo,
} from '@/lib/nfe/sefaz'

/**
 * GET /api/fiscal/nfe-recebidas — Listar NF-e recebidas (local + SEFAZ)
 * POST /api/fiscal/nfe-recebidas — Sincronizar com SEFAZ (DFe Distribuição)
 */
export async function GET(req: NextRequest) {
  try {
    const result = await requirePermission('fiscal', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const page = Math.max(1, Number(req.nextUrl.searchParams.get('page') || '1'))
    const limit = Math.min(100, Number(req.nextUrl.searchParams.get('limit') || '20'))

    const [recebidas, total] = await Promise.all([
      prisma.nfeRecebida.findMany({
        where: { company_id: user.companyId },
        orderBy: { data_emissao: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.nfeRecebida.count({ where: { company_id: user.companyId } }),
    ])

    return success({ data: recebidas, total, page, limit, totalPages: Math.ceil(total / limit) })
  } catch (err) {
    return handleError(err)
  }
}

/**
 * POST — Sincronizar NF-e recebidas da SEFAZ via DFe Distribuição
 * Body: { nsu_inicial?: string } (opcional, para continuar de onde parou)
 */
export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('fiscal', 'create')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json().catch(() => ({}))

    const fiscalCfg = await prisma.fiscalConfig.findUnique({ where: { company_id: user.companyId } })
    if (!fiscalCfg) return error('Config fiscal não encontrada', 400)
    const fiscalSettings = (fiscalCfg.settings || {}) as Record<string, any>
    if (!fiscalSettings.certificate_base64) return error('Certificado A1 não instalado', 400)

    let certPassword = ''
    if (fiscalSettings.certificate_password) {
      const { decrypt } = await import('@/lib/encryption')
      certPassword = decrypt(fiscalSettings.certificate_password)
    }
    const cert = extractCertificate(fiscalSettings.certificate_base64, certPassword)

    const settings = await prisma.setting.findMany({ where: { company_id: user.companyId } })
    const cfg: Record<string, string> = {}
    for (const s of settings) cfg[s.key] = s.value
    const cnpj = (cfg['cnab.cnpj'] || cert.cnpj || '').padStart(14, '0')
    const uf = cfg['cnab.uf'] || 'SP'
    const ambiente = fiscalCfg.environment === 'producao' ? '1' : '2'
    const cUF = getUfCodigo(uf)
    const endpoints = getSefazEndpoints(uf, ambiente as '1' | '2')

    // NSU inicial: último sincronizado ou 0
    let ultNSU = body.nsu_inicial || cfg['nfe.ultimo_nsu'] || '0'
    ultNSU = String(ultNSU).padStart(15, '0')

    // Montar XML de consulta DFe
    const distXml = `<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
      <tpAmb>${ambiente}</tpAmb>
      <cUFAutor>${cUF}</cUFAutor>
      <CNPJ>${cnpj}</CNPJ>
      <distNSU>
        <ultNSU>${ultNSU}</ultNSU>
      </distNSU>
    </distDFeInt>`

    let sefazResponse: string
    try {
      sefazResponse = await sendSoapRequest({
        url: endpoints.distribuicaoDFe,
        action: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse',
        body: distXml,
        privateKeyPem: cert.privateKeyPem,
        certificatePem: cert.certificatePem,
        timeout: 30000,
      })
    } catch (sefazErr: any) {
      console.error('[NF-e Recebidas] Erro SEFAZ:', sefazErr.message)
      // Log para debug
      await prisma.fiscalLog.create({
        data: {
          company_id: user.companyId,
          action: 'nfe_recebidas_sync_error',
          response: {
            error: sefazErr.message,
            url: endpoints.distribuicaoDFe,
            cnpj,
            uf,
            ambiente,
            certCnpj: cert.cnpj,
            certValid: `${cert.validFrom.toISOString()} - ${cert.validTo.toISOString()}`,
          },
        },
      })
      return error(`Erro de comunicação com SEFAZ: ${sefazErr.message}`, 502)
    }

    const responseBody = extractSoapBody(sefazResponse)
    const cStat = responseBody.match(/<cStat>(\d+)<\/cStat>/)?.[1] || ''
    const maxNSU = responseBody.match(/<maxNSU>(\d+)<\/maxNSU>/)?.[1] || ultNSU

    // Parsear documentos retornados
    const docRegex = /<docZip[^>]*NSU="(\d+)"[^>]*>([\s\S]*?)<\/docZip>/g
    let match
    let imported = 0

    while ((match = docRegex.exec(responseBody)) !== null) {
      const nsu = match[1]
      const contentB64 = match[2]

      try {
        // Decodificar base64 + inflate (gzip)
        const zlib = require('zlib')
        const buffer = Buffer.from(contentB64, 'base64')
        let xmlContent: string
        try {
          xmlContent = zlib.inflateSync(buffer).toString('utf-8')
        } catch {
          xmlContent = buffer.toString('utf-8')
        }

        // Extrair dados básicos do XML
        const chave = xmlContent.match(/<chNFe>(\d{44})<\/chNFe>/)?.[1] || ''
        const nNF = xmlContent.match(/<nNF>(\d+)<\/nNF>/)?.[1] || ''
        const serie = xmlContent.match(/<serie>(\d+)<\/serie>/)?.[1] || ''
        const cnpjEmit = xmlContent.match(/<emit>[\s\S]*?<CNPJ>(\d+)<\/CNPJ>/)?.[1] || ''
        const nomeEmit = xmlContent.match(/<xNome>([^<]+)<\/xNome>/)?.[1] || ''
        const vNF = xmlContent.match(/<vNF>([^<]+)<\/vNF>/)?.[1] || '0'
        const dhEmi = xmlContent.match(/<dhEmi>([^<]+)<\/dhEmi>/)?.[1] || ''
        const cSitNFe = xmlContent.match(/<cSitNFe>(\d)<\/cSitNFe>/)?.[1]

        if (chave && chave.length === 44) {
          await prisma.nfeRecebida.upsert({
            where: { company_id_chave_nfe: { company_id: user.companyId, chave_nfe: chave } },
            create: {
              company_id: user.companyId,
              chave_nfe: chave,
              numero: parseInt(nNF) || null,
              serie: serie || null,
              cnpj_emitente: cnpjEmit,
              nome_emitente: nomeEmit,
              valor_total: Math.round(parseFloat(vNF) * 100),
              data_emissao: dhEmi ? new Date(dhEmi) : null,
              situacao: cSitNFe === '1' ? 'autorizada' : 'pendente',
              xml_data: { nsu, xml: xmlContent.substring(0, 50000) },
            },
            update: {
              nome_emitente: nomeEmit || undefined,
              valor_total: Math.round(parseFloat(vNF) * 100) || undefined,
              xml_data: { nsu, xml: xmlContent.substring(0, 50000) },
              updated_at: new Date(),
            },
          })
          imported++
        }
      } catch { /* skip invalid docs */ }
    }

    // Salvar último NSU
    await prisma.setting.upsert({
      where: { company_id_key: { company_id: user.companyId, key: 'nfe.ultimo_nsu' } },
      create: { company_id: user.companyId, key: 'nfe.ultimo_nsu', value: maxNSU, type: 'string' },
      update: { value: maxNSU },
    })

    // Salvar log para debug
    await prisma.fiscalLog.create({
      data: {
        company_id: user.companyId,
        action: 'nfe_recebidas_sync',
        request: { ultNSU, cnpj, uf, ambiente, url: endpoints.distribuicaoDFe },
        response: { cStat, xMotivo: responseBody.match(/<xMotivo>([^<]+)<\/xMotivo>/)?.[1] || '', maxNSU, imported },
        status_code: parseInt(cStat) || 0,
      },
    })

    const xMotivo = responseBody.match(/<xMotivo>([^<]+)<\/xMotivo>/)?.[1] || ''

    return success({
      cStat,
      motivo: xMotivo,
      documentos_importados: imported,
      ultimo_nsu: maxNSU,
      tem_mais: cStat === '138', // 138 = ainda tem documentos
      ambiente: ambiente === '1' ? 'Producao' : 'Homologacao',
      cnpj,
    })
  } catch (err) {
    return handleError(err)
  }
}
