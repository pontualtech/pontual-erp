import 'server-only'
import { prisma } from '@pontual/db'

/**
 * Retorna a primeira conta bancaria ATIVA de uma empresa que tenha
 * provider_config valido (api_key setado). Usado quando o portal do
 * cliente vai gerar PIX/Boleto e nao precisa que o usuario escolha
 * conta — pega a primeira disponivel.
 *
 * Retorna null se:
 *  - Empresa nao tem conta com provider_config
 *  - provider_config nao tem api_key
 *
 * Quando suporte a multiplas contas ativas for necessario, adicionar
 * campo 'is_default' no schema e usar aqui.
 */
export async function resolveDefaultProviderAccount(companyId: string): Promise<{
  accountId: string
  provider: string
} | null> {
  const accounts = await prisma.account.findMany({
    where: { company_id: companyId, is_active: true },
    select: { id: true, provider_config: true },
    orderBy: { created_at: 'asc' },
  })
  for (const a of accounts) {
    const cfg = (a.provider_config as Record<string, string>) || {}
    if (cfg.provider && cfg.api_key) {
      return { accountId: a.id, provider: String(cfg.provider).toLowerCase() }
    }
  }
  return null
}
