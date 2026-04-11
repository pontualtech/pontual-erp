import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { authenticateBot } from '../_lib/auth'
import { botSuccess, botError } from '../_lib/response'

/**
 * GET /api/bot/equipamentos
 * Returns equipment types, brands, and models for the website form.
 * Data comes from ERP settings (same as the dashboard form).
 * Auth: X-Bot-Key header ou ?key= query param
 */
export async function GET(req: NextRequest) {
  try {
    const auth = authenticateBot(req)
    if (auth instanceof NextResponse) return auth

    const companyId = auth.companyId

    // 1. Equipment types (from setting os.equipamentos)
    const tiposSetting = await prisma.setting.findUnique({
      where: { company_id_key: { company_id: companyId, key: 'os.equipamentos' } },
    })
    let tipos: string[] = []
    if (tiposSetting?.value) { try { tipos = JSON.parse(tiposSetting.value) } catch {} }
    if (tipos.length === 0) {
      tipos = ['Impressora', 'Notebook', 'Termica', 'Multifuncional', 'Plotter', 'Scanner', 'Computador', 'Monitor']
    }

    // 2. Brands (from settings marca.*)
    const marcaSettings = await prisma.setting.findMany({
      where: { company_id: companyId, key: { startsWith: 'marca.' } },
      orderBy: { value: 'asc' },
    })
    const marcas = marcaSettings.map(s => s.value)

    // 3. Models grouped by brand (from settings modelo.{brand}.{model})
    const modeloSettings = await prisma.setting.findMany({
      where: { company_id: companyId, key: { startsWith: 'modelo.' } },
      orderBy: { value: 'asc' },
    })
    const modelos: Record<string, string[]> = {}
    for (const s of modeloSettings) {
      // key format: modelo.HP.LaserJet Pro M404
      const parts = s.key.replace('modelo.', '').split('.')
      const brand = parts[0]
      if (!brand) continue
      if (!modelos[brand]) modelos[brand] = []
      modelos[brand].push(s.value)
    }

    return botSuccess({ tipos, marcas, modelos })
  } catch (err: any) {
    console.error('[Bot equipamentos]', err.message)
    return botError('Erro interno', 500)
  }
}
