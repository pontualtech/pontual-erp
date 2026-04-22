import { prisma } from '@pontual/db'

/**
 * Normaliza nome pra match tolerante a acentos/cedilha/caixa.
 * "Orcar" / "Orcar" / "ORCAR" -> "orcar"
 * Usa escape Unicode (̀-ͯ = combining diacritical marks)
 * pra nao depender da codificacao do arquivo fonte.
 */
function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
}

/**
 * Busca um ModuleStatus por nome com matching tolerante.
 * Acentos, cedilha e caixa sao ignorados — funciona tanto com
 * PontualTech ("Orcar") quanto com Imprimitech ("Orcar" com cedilha)
 * sem precisar sincronizar nomenclatura entre empresas.
 *
 * Aceita uma lista de aliases — retorna o primeiro match.
 */
export async function findStatusByName(
  companyId: string,
  module: string,
  ...aliases: string[]
): Promise<{ id: string; name: string } | null> {
  const all = await prisma.moduleStatus.findMany({
    where: { company_id: companyId, module },
    select: { id: true, name: true },
  })
  const targets = aliases.map(norm)
  for (const target of targets) {
    const match = all.find(s => norm(s.name) === target)
    if (match) return match
  }
  return null
}
