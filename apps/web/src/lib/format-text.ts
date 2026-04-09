/**
 * Formatação inteligente de texto para o ERP.
 * Corrige entrada do usuário: maiúsculas/minúsculas misturadas,
 * tudo maiúsculo, tudo minúsculo, espaços extras, etc.
 */

// Preposições e artigos que ficam minúsculos (exceto no início)
const LOWERCASE_WORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'na', 'no', 'nas', 'nos',
  'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas',
  'com', 'sem', 'por', 'para', 'pela', 'pelo', 'pelas', 'pelos',
  'que', 'se', 'ou', 'ao', 'aos',
])

// Siglas e abreviações que ficam MAIÚSCULAS
const UPPERCASE_WORDS = new Set([
  'ltda', 'me', 'epp', 'eireli', 'sa', 's/a', 's.a', 's.a.',
  'cpf', 'cnpj', 'rg', 'cep',
  'hp', 'ibm', 'lg', 'oki', 'nec',
  'os', 'nf', 'nfe', 'nfs', 'nfse',
  'sp', 'rj', 'mg', 'pr', 'sc', 'rs', 'ba', 'ce', 'pe', 'go', 'mt', 'ms',
  'df', 'es', 'pa', 'am', 'ma', 'pi', 'pb', 'rn', 'al', 'se', 'to', 'ro',
  'ac', 'ap', 'rr',
  'ii', 'iii', 'iv', 'vi', 'vii', 'viii', 'ix', 'xi', 'xii',
])

/**
 * Formata nome próprio (pessoa/empresa):
 * "joao da silva" → "João da Silva"
 * "MARIA DE SOUZA" → "Maria de Souza"
 * "jOsE dA sIlVa LTDA" → "José da Silva LTDA"
 */
export function formatName(input: string): string {
  if (!input) return input

  const cleaned = input.trim().replace(/\s+/g, ' ')
  if (!cleaned) return cleaned

  const words = cleaned.toLowerCase().split(' ')

  return words
    .map((word, index) => {
      // Siglas ficam MAIÚSCULAS
      if (UPPERCASE_WORDS.has(word) || UPPERCASE_WORDS.has(word.replace(/[./]/g, ''))) {
        return word.toUpperCase()
      }

      // Preposições/artigos ficam minúsculas (exceto primeira palavra)
      if (index > 0 && LOWERCASE_WORDS.has(word)) {
        return word
      }

      // Capitalizar primeira letra
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join(' ')
}

/**
 * Formata para UPPERCASE padrão ERP (nomes no banco ficam maiúsculos):
 * "joao da silva" → "JOAO DA SILVA"
 * Limpa espaços extras.
 */
export function formatUpperCase(input: string): string {
  if (!input) return input
  return input.trim().replace(/\s+/g, ' ').toUpperCase()
}

/**
 * Formata endereço (Title Case, mas mantém siglas):
 * "rua ouvidor peleja" → "Rua Ouvidor Peleja"
 * "AV PAULISTA" → "Av Paulista"
 */
export function formatAddress(input: string): string {
  if (!input) return input
  return formatName(input)
}

/**
 * Formata descrição/observações:
 * Capitaliza primeira letra de cada frase, limpa espaços.
 */
export function formatDescription(input: string): string {
  if (!input) return input

  const cleaned = input.trim().replace(/\s+/g, ' ')

  // Capitalizar início de cada frase (após . ! ? e no início)
  return cleaned.replace(/(^|[.!?]\s+)(\w)/g, (_, prefix, char) =>
    prefix + char.toUpperCase()
  )
}

/**
 * Formata email (sempre lowercase, trim):
 */
export function formatEmail(input: string): string {
  if (!input) return input
  return input.trim().toLowerCase()
}

/**
 * Formata telefone (apenas dígitos):
 */
export function formatPhone(input: string): string {
  if (!input) return input
  return input.replace(/\D/g, '')
}

/**
 * Formata documento (CPF/CNPJ — apenas dígitos):
 */
export function formatDocument(input: string): string {
  if (!input) return input
  return input.replace(/\D/g, '')
}

/**
 * Auto-formata baseado no tipo de campo.
 * Uso: formatField('name', valor) ou formatField('address_street', valor)
 */
export function formatField(fieldName: string, value: string): string {
  if (!value || typeof value !== 'string') return value

  const name = fieldName.toLowerCase()

  // Nomes → UPPERCASE para banco do ERP
  if (name.includes('legal_name') || name.includes('trade_name') || name.includes('name') && !name.includes('file')) {
    return formatUpperCase(value)
  }

  // Endereços → UPPERCASE para banco do ERP
  if (name.includes('address_') || name.includes('street') || name.includes('neighborhood') || name.includes('city')) {
    return formatUpperCase(value)
  }

  // Estado → UPPERCASE (2 letras)
  if (name === 'address_state' || name === 'state') {
    return value.trim().toUpperCase().slice(0, 2)
  }

  // Email → lowercase
  if (name.includes('email')) {
    return formatEmail(value)
  }

  // Telefone/celular → apenas dígitos
  if (name.includes('phone') || name.includes('mobile') || name.includes('telefone') || name.includes('celular')) {
    return formatPhone(value)
  }

  // Documento → apenas dígitos
  if (name.includes('document') || name.includes('cpf') || name.includes('cnpj')) {
    return formatDocument(value)
  }

  // CEP → apenas dígitos
  if (name.includes('zip') || name.includes('cep')) {
    return value.replace(/\D/g, '')
  }

  // Descrições/observações → capitalizar primeira letra
  if (name.includes('description') || name.includes('notes') || name.includes('diagnosis') || name.includes('issue') || name.includes('observ')) {
    return formatDescription(value)
  }

  // Equipamento tipo/marca/modelo → UPPERCASE
  if (name.includes('equipment') || name.includes('brand') || name.includes('model') || name.includes('serial')) {
    return formatUpperCase(value)
  }

  // Default: trim
  return value.trim()
}

/**
 * Formata descrição de equipamento sem duplicação.
 * "CANON G7010 - CANON G7010" → "CANON G7010"
 * "Impressora - HP LaserJet" → "Impressora - HP LaserJet"
 */
export function formatEquipment(type?: string, brand?: string, model?: string): string {
  const parts: string[] = []
  const t = (type || '').trim()
  const b = (brand || '').trim()
  const m = (model || '').trim()

  if (t) parts.push(t)
  if (b && b.toLowerCase() !== t.toLowerCase()) parts.push(b)
  if (m && m.toLowerCase() !== t.toLowerCase() && m.toLowerCase() !== b.toLowerCase()) parts.push(m)

  return parts.join(' ') || 'Equipamento'
}

/**
 * Formata todos os campos de texto de um objeto.
 * Uso: formatAllFields({ legal_name: 'jOaO', email: 'FOO@bar.COM' })
 */
export function formatAllFields<T extends Record<string, unknown>>(obj: T): T {
  const result = { ...obj }

  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'string') {
      (result as Record<string, unknown>)[key] = formatField(key, value)
    }
  }

  return result
}
