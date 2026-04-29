/**
 * Mapping User ERP -> Ramal SIP
 *
 * MVP F2.1: configurado via env var SONAX_RAMAL_MAPPING (JSON)
 *   { "roberto@pontualtech.com.br": "101", "daniela@...": "102", ... }
 *
 * Próxima evolução (F2.4): mapping persistido em voip_extensions.user_id
 * (FK pra user_profiles), gerenciado via UI Super Admin.
 *
 * Por que env por agora:
 * - Sem schema change pra entregar Click2Call rápido.
 * - Fácil de ajustar via Coolify env editor sem deploy.
 * - Cache simples em memória (1 leitura por instância).
 */

export interface ExtensionMapping {
  [emailLowercase: string]: string
}

let cachedMap: ExtensionMapping | null = null

function loadMap(): ExtensionMapping {
  if (cachedMap) return cachedMap
  const raw = process.env.SONAX_RAMAL_MAPPING || '{}'
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const normalized: ExtensionMapping = {}
    for (const [email, ramal] of Object.entries(parsed)) {
      if (typeof email === 'string' && typeof ramal === 'string' && email && ramal) {
        normalized[email.toLowerCase()] = ramal.replace(/\D/g, '')
      }
    }
    cachedMap = normalized
    return normalized
  } catch {
    cachedMap = {}
    return {}
  }
}

/**
 * Retorna o ramal SIP de um usuário pelo email, ou null se não cadastrado.
 *
 * Email comparado case-insensitive. Ramal sanitizado (só dígitos).
 */
export function getExtensionByEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const map = loadMap()
  return map[email.toLowerCase()] || null
}

/**
 * Útil pra UI Super Admin futura: lista todos mappings ativos.
 */
export function listExtensionMappings(): Array<{ email: string; ramal: string }> {
  const map = loadMap()
  return Object.entries(map).map(([email, ramal]) => ({ email, ramal }))
}

/**
 * Reset cache - útil em testes ou após mudança de env.
 * Em produção, basta restart do container pra recarregar.
 */
export function _resetExtensionMapCache(): void {
  cachedMap = null
}
