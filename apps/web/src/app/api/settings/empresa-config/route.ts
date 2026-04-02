import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

// Todas as settings da empresa
const EMPRESA_KEYS = [
  // Dados da Empresa
  'cnab.cnpj', 'cnab.razao_social', 'company.nome_fantasia',
  'company.ie', 'company.im', 'company.cnae',
  // Endereco
  'cnab.endereco', 'company.number', 'company.complemento',
  'cnab.bairro', 'cnab.cidade', 'company.cod_municipio', 'cnab.uf', 'cnab.cep',
  // Contato
  'company.phone', 'company.whatsapp', 'company.email', 'company.website',
  // Email SMTP
  'email.from_name', 'email.from_address',
  // Portal do Cliente
  'portal.quote_url', 'portal.url',
  // NFS-e Servico
  'nfse.codigo_municipio', 'nfse.aliquota_iss', 'nfse.codigo_servico',
  'company.crt',
]

// Mapa campo do form -> chave no banco
const FIELD_MAP: Record<string, string> = {
  // Dados da Empresa
  razao_social: 'cnab.razao_social',
  nome_fantasia: 'company.nome_fantasia',
  cnpj: 'cnab.cnpj',
  ie: 'company.ie',
  im: 'company.im',
  cnae: 'company.cnae',
  // Endereco
  logradouro: 'cnab.endereco',
  numero: 'company.number',
  complemento: 'company.complemento',
  bairro: 'cnab.bairro',
  municipio: 'cnab.cidade',
  cod_municipio: 'company.cod_municipio',
  uf: 'cnab.uf',
  cep: 'cnab.cep',
  // Contato
  phone: 'company.phone',
  whatsapp: 'company.whatsapp',
  email: 'company.email',
  website: 'company.website',
  // Email SMTP
  from_name: 'email.from_name',
  from_address: 'email.from_address',
  // Portal do Cliente
  quote_url: 'portal.quote_url',
  portal_url: 'portal.url',
  // NFS-e Servico
  nfse_codigo_municipio: 'nfse.codigo_municipio',
  aliquota_iss: 'nfse.aliquota_iss',
  codigo_servico: 'nfse.codigo_servico',
  crt: 'company.crt',
}

// Inverso
const KEY_MAP = Object.fromEntries(Object.entries(FIELD_MAP).map(([k, v]) => [v, k]))

/**
 * GET /api/settings/empresa-config — Carregar configuracoes da empresa
 */
export async function GET() {
  try {
    const result = await requirePermission('config', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const settings = await prisma.setting.findMany({
      where: { company_id: user.companyId, key: { in: EMPRESA_KEYS } },
    })

    const data: Record<string, string> = {}
    for (const s of settings) {
      const field = KEY_MAP[s.key]
      if (field) data[field] = s.value
    }

    // Buscar nome da empresa da tabela Company
    const company = await prisma.company.findUnique({
      where: { id: user.companyId },
      select: { name: true },
    })
    if (company?.name) data.company_name = company.name

    // Info sobre Resend
    data.resend_configured = process.env.RESEND_API_KEY ? 'true' : 'false'

    // URL do app (env var)
    if (!data.portal_url && process.env.NEXT_PUBLIC_APP_URL) {
      data.app_url_env = process.env.NEXT_PUBLIC_APP_URL
    }

    return success(data)
  } catch (err) {
    return handleError(err)
  }
}

/**
 * PUT /api/settings/empresa-config — Salvar configuracoes da empresa
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

    // Atualizar Company.name se razao_social ou nome_fantasia fornecido
    const displayName = body.nome_fantasia || body.razao_social
    if (displayName) {
      await prisma.company.update({
        where: { id: user.companyId },
        data: { name: displayName },
      })
    }

    return success({ saved: true })
  } catch (err) {
    return handleError(err)
  }
}
