import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requireSuperAdmin } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { randomBytes } from 'crypto'

// Roles padrão para toda nova empresa
const DEFAULT_ROLES = [
  { name: 'Admin', description: 'Administrador com acesso total', is_system: true },
  { name: 'Atendente', description: 'Atendimento e criação de OS', is_system: false },
  { name: 'Técnico', description: 'Técnico de campo/bancada', is_system: false },
  { name: 'Motorista', description: 'Motorista de coleta e entrega', is_system: false },
  { name: 'Financeiro', description: 'Acesso ao módulo financeiro', is_system: false },
  { name: 'Suporte', description: 'Suporte ao cliente via chat/ticket', is_system: false },
]

// Status padrão de OS
const DEFAULT_OS_STATUSES = [
  { name: 'Aberta', color: '#3B82F6', order: 0, is_default: true, is_final: false },
  { name: 'Aguardando Peça', color: '#F59E0B', order: 1, is_default: false, is_final: false },
  { name: 'Aguardando Aprovação', color: '#F97316', order: 2, is_default: false, is_final: false },
  { name: 'Aprovada', color: '#10B981', order: 3, is_default: false, is_final: false },
  { name: 'Em Andamento', color: '#6366F1', order: 4, is_default: false, is_final: false },
  { name: 'Em Teste', color: '#8B5CF6', order: 5, is_default: false, is_final: false },
  { name: 'Pronta p/ Entrega', color: '#14B8A6', order: 6, is_default: false, is_final: false },
  { name: 'Em Rota de Entrega', color: '#06B6D4', order: 7, is_default: false, is_final: false },
  { name: 'Entregue', color: '#22C55E', order: 8, is_default: false, is_final: true },
  { name: 'Cancelada', color: '#EF4444', order: 9, is_default: false, is_final: true },
]

// Equipamentos padrão
const DEFAULT_EQUIPAMENTOS = ['Impressora', 'Notebook', 'Termica', 'Multifuncional', 'Plotter', 'Scanner', 'Computador', 'Monitor']

// Marcas padrão
const DEFAULT_MARCAS = ['Epson', 'HP', 'Canon', 'Brother', 'Samsung', 'Lexmark', 'Elgin', 'Bematech', 'Zebra']

// POST /api/admin/companies/[id]/setup — Auto-setup completo da empresa
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const result = await requireSuperAdmin()
    if (result instanceof NextResponse) return result

    const company = await prisma.company.findUnique({ where: { id: params.id } })
    if (!company) return error('Empresa não encontrada', 404)

    // Verificar se já tem setup (se já tem roles, já foi feito)
    const existingRoles = await prisma.role.count({ where: { company_id: params.id } })
    if (existingRoles > 0) return error('Empresa já possui setup inicial. Use force=true para refazer.', 409)

    const setup = await prisma.$transaction(async (tx) => {
      // 1. Criar Roles
      const roles = await Promise.all(
        DEFAULT_ROLES.map(r =>
          tx.role.create({ data: { company_id: params.id, ...r } })
        )
      )

      // 2. Criar Status de OS
      const statuses = await Promise.all(
        DEFAULT_OS_STATUSES.map(s =>
          tx.moduleStatus.create({
            data: { company_id: params.id, module: 'os', ...s, transitions: '[]' },
          })
        )
      )

      // 3. Criar Settings (equipamentos, marcas)
      await tx.setting.create({
        data: {
          company_id: params.id,
          key: 'os.equipamentos',
          value: JSON.stringify(DEFAULT_EQUIPAMENTOS),
          type: 'json',
        },
      })

      for (const marca of DEFAULT_MARCAS) {
        await tx.setting.upsert({
          where: { company_id_key: { company_id: params.id, key: `marca.${marca}` } },
          create: { company_id: params.id, key: `marca.${marca}`, value: marca, type: 'string' },
          update: {},
        })
      }

      // 4. Gerar Bot API Key
      const botApiKey = randomBytes(32).toString('hex')
      const botSecret = randomBytes(16).toString('hex')
      await tx.apiKey.create({
        data: {
          companyId: params.id,
          name: `Bot ${company.name}`,
          key: botApiKey,
          secret: botSecret,
          permissions: ['bot:full'],
          isActive: true,
        },
      })

      // 5. Setting para número inicial de OS
      await tx.setting.create({
        data: {
          company_id: params.id,
          key: 'os.next_number',
          value: '1000',
          type: 'number',
        },
      })

      return {
        roles: roles.map(r => ({ id: r.id, name: r.name })),
        statuses: statuses.length,
        equipamentos: DEFAULT_EQUIPAMENTOS.length,
        marcas: DEFAULT_MARCAS.length,
        botApiKey,
      }
    })

    return success({
      message: `Setup completo para ${company.name}`,
      companyId: company.id,
      slug: company.slug,
      ...setup,
    }, 201)
  } catch (err) {
    return handleError(err)
  }
}
