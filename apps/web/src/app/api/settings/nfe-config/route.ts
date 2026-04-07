import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

// Todas as settings de NF-e usam prefixo "nfe." ou "company."
const NFE_KEYS = [
  'cnab.cnpj', 'cnab.razao_social', 'company.nome_fantasia',
  'company.ie', 'company.im', 'company.cnae', 'company.crt',
  'cnab.endereco', 'company.number', 'company.complemento',
  'cnab.bairro', 'company.cod_municipio', 'cnab.cidade', 'cnab.uf', 'cnab.cep',
  'company.phone',
  'nfe.ambiente', 'nfe.serie', 'nfe.proximo_numero',
  'nfe.csosn_padrao', 'nfe.aliquota_simples', 'nfe.cfop_venda_interna', 'nfe.cfop_venda_interestadual', 'nfe.cfop_devolucao',
  'nfe.info_complementar',
]

// Mapa campo do form -> chave no banco
const FIELD_MAP: Record<string, string> = {
  cnpj: 'cnab.cnpj',
  razao_social: 'cnab.razao_social',
  nome_fantasia: 'company.nome_fantasia',
  inscricao_estadual: 'company.ie',
  inscricao_municipal: 'company.im',
  cnae: 'company.cnae',
  crt: 'company.crt',
  logradouro: 'cnab.endereco',
  numero: 'company.number',
  complemento: 'company.complemento',
  bairro: 'cnab.bairro',
  codigo_municipio: 'company.cod_municipio',
  municipio: 'cnab.cidade',
  uf: 'cnab.uf',
  cep: 'cnab.cep',
  telefone: 'company.phone',
  ambiente: 'nfe.ambiente',
  serie: 'nfe.serie',
  proximo_numero: 'nfe.proximo_numero',
  csosn_padrao: 'nfe.csosn_padrao',
  aliquota_simples: 'nfe.aliquota_simples',
  cfop_venda_interna: 'nfe.cfop_venda_interna',
  cfop_venda_interestadual: 'nfe.cfop_venda_interestadual',
  cfop_devolucao: 'nfe.cfop_devolucao',
  info_complementar: 'nfe.info_complementar',
}

// Inverso
const KEY_MAP = Object.fromEntries(Object.entries(FIELD_MAP).map(([k, v]) => [v, k]))

/**
 * GET /api/settings/nfe-config — Carregar configuracoes NF-e
 */
export async function GET() {
  try {
    const result = await requirePermission('config', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const settings = await prisma.setting.findMany({
      where: { company_id: user.companyId, key: { in: NFE_KEYS } },
    })

    const data: Record<string, string> = {}
    for (const s of settings) {
      const field = KEY_MAP[s.key]
      if (field) data[field] = s.value
    }

    // Info do certificado (rich info)
    const fiscalCfg = await prisma.fiscalConfig.findUnique({ where: { company_id: user.companyId } })
    const fiscalSettings = (fiscalCfg?.settings || {}) as Record<string, any>
    if (fiscalSettings.certificate_base64) {
      data.cert_instalado = 'true'
      try {
        const { extractCertificate } = await import('@/lib/nfe/sefaz/certificate')
        let pw = ''
        if (fiscalSettings.certificate_password) {
          const { decrypt } = await import('@/lib/encryption')
          pw = decrypt(fiscalSettings.certificate_password)
        } else if (fiscalCfg?.certificate_password) {
          // Password may be stored directly on the model
          pw = fiscalCfg.certificate_password
        }
        const cert = extractCertificate(fiscalSettings.certificate_base64, pw)
        data.cert_validade = cert.validTo.toISOString()
        data.cert_valid_from = cert.validFrom.toISOString()
        data.cert_cnpj = cert.cnpj
        data.cert_subject = cert.razaoSocial
      } catch {
        data.cert_validade = ''
        data.cert_cnpj = ''
        data.cert_subject = ''
      }
      // Fallback to stored metadata
      if (fiscalSettings.certificate_subject) {
        data.cert_subject = data.cert_subject || fiscalSettings.certificate_subject
      }
      if (fiscalSettings.certificate_issuer) {
        data.cert_issuer = fiscalSettings.certificate_issuer
      }
      if (fiscalSettings.certificate_filename) {
        data.cert_filename = fiscalSettings.certificate_filename
      }
    }

    // Numero da serie
    const serie = data.serie || '1'
    try {
      const nfeSerie = await prisma.$queryRawUnsafe(
        `SELECT last_number FROM nfe_series WHERE company_id = '${user.companyId}' AND serie = '${serie}'`
      ) as any[]
      if (nfeSerie.length > 0) data.proximo_numero = String(Number(nfeSerie[0].last_number) + 1)
    } catch {
      // nfe_series table may not exist yet
    }

    return success(data)
  } catch (err) {
    return handleError(err)
  }
}

/**
 * PUT /api/settings/nfe-config — Salvar configuracoes NF-e
 */
export async function PUT(req: NextRequest) {
  try {
    const result = await requirePermission('config', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()

    for (const [field, settingKey] of Object.entries(FIELD_MAP)) {
      const value = body[field]
      if (value !== undefined && value !== null) {
        await prisma.setting.upsert({
          where: { company_id_key: { company_id: user.companyId, key: settingKey } },
          create: { company_id: user.companyId, key: settingKey, value: String(value), type: 'string' },
          update: { value: String(value) },
        })
      }
    }

    // Atualizar FiscalConfig
    const fiscalCfg = await prisma.fiscalConfig.findUnique({ where: { company_id: user.companyId } })
    if (fiscalCfg) {
      const settings = (fiscalCfg.settings || {}) as Record<string, any>
      if (body.inscricao_estadual) settings.inscricao_estadual = body.inscricao_estadual
      if (body.crt) settings.crt = body.crt
      if (body.codigo_municipio) settings.codigo_municipio = body.codigo_municipio
      await prisma.fiscalConfig.update({
        where: { company_id: user.companyId },
        data: {
          environment: body.ambiente === '1' ? 'producao' : 'homologacao',
          settings,
        },
      })
    }

    // Atualizar serie
    if (body.serie && body.proximo_numero) {
      const nextNum = Math.max(0, parseInt(body.proximo_numero) - 1)
      try {
        await prisma.$executeRawUnsafe(`
          INSERT INTO nfe_series (company_id, serie, last_number) VALUES ('${user.companyId}', '${body.serie}', ${nextNum})
          ON CONFLICT (company_id, serie) DO UPDATE SET last_number = ${nextNum}, updated_at = NOW()
        `)
      } catch {
        // nfe_series table may not exist yet
      }
    }

    return success({ saved: true })
  } catch (err) {
    return handleError(err)
  }
}
