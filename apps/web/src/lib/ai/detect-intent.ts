/**
 * Intent detection — uses OpenAI (gpt-4o-mini) or Claude,
 * with a keyword-based fallback when no API key is configured.
 */

export type IntentAction =
  | 'CONSULTAR_OS'
  | 'NOVO_ORCAMENTO'
  | 'AGENDAR_COLETA'
  | 'STATUS_PAGAMENTO'
  | 'FALAR_HUMANO'
  | 'GENERAL'

export interface DetectedIntent {
  action: IntentAction
  params: Record<string, any>
  confidence: number
}

export interface CustomerContext {
  id: string
  name: string
  phone?: string
  lastOsNumber?: number
  lastOsStatus?: string
  totalOs?: number
}

// ---------------------------------------------------------------------------
// System prompt for AI-based intent detection
// ---------------------------------------------------------------------------

function buildSystemPrompt(customerContext?: CustomerContext, customPrompt?: string): string {
  const base = customPrompt || `Voce e o assistente virtual da PontualTech, uma assistencia tecnica especializada em impressoras, notebooks e equipamentos de informatica em Sao Paulo.

Seu trabalho e classificar a intencao da mensagem do cliente em uma das categorias abaixo e extrair parametros relevantes.`

  const intents = `
INTENCOES DISPONIVEIS:
- CONSULTAR_OS: Cliente quer saber o status de uma OS (ordem de servico). Exemplos: "como ta minha impressora?", "qual o status da OS 1234?", "meu equipamento ta pronto?", "ja consertaram?"
- NOVO_ORCAMENTO: Cliente quer trazer um equipamento para conserto/orcamento. Exemplos: "minha impressora parou", "preciso consertar um notebook", "quero levar pra arrumar", "quanto custa o conserto?"
- AGENDAR_COLETA: Cliente quer agendar uma coleta/retirada. Exemplos: "podem buscar aqui?", "preciso de coleta", "agendar retirada", "manda alguem buscar"
- STATUS_PAGAMENTO: Cliente quer saber sobre pagamento/valores. Exemplos: "quanto devo?", "tem boleto?", "qual o valor?", "ja paguei", "status do pagamento"
- FALAR_HUMANO: Cliente quer falar com um atendente humano. Exemplos: "quero falar com alguem", "atendente", "pessoa real", "humano", "nao quero bot"
- GENERAL: Qualquer outra pergunta ou conversa geral. Exemplos: "bom dia", "horario de funcionamento", "onde fica?", "obrigado"
`

  let customerInfo = ''
  if (customerContext) {
    customerInfo = `
CONTEXTO DO CLIENTE:
- Nome: ${customerContext.name}
- Total de OS: ${customerContext.totalOs || 0}
${customerContext.lastOsNumber ? `- Ultima OS: #${customerContext.lastOsNumber} (Status: ${customerContext.lastOsStatus || 'desconhecido'})` : ''}
`
  }

  return `${base}
${intents}
${customerInfo}
Responda APENAS com JSON no formato:
{"action": "NOME_DA_INTENCAO", "params": {"os_number": 1234}, "confidence": 0.95}

O campo params pode conter:
- os_number: numero da OS se mencionado
- equipment_type: tipo de equipamento mencionado
- issue: problema relatado
- address: endereco para coleta

Se nenhum parametro for relevante, retorne params: {}`
}

// ---------------------------------------------------------------------------
// AI-based detection (OpenAI or Claude)
// ---------------------------------------------------------------------------

async function detectWithOpenAI(
  message: string,
  apiKey: string,
  customerContext?: CustomerContext,
  customPrompt?: string
): Promise<DetectedIntent> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      max_tokens: 200,
      messages: [
        { role: 'system', content: buildSystemPrompt(customerContext, customPrompt) },
        { role: 'user', content: message },
      ],
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`OpenAI API ${res.status}: ${body}`)
  }

  const data = await res.json()
  const content = data.choices?.[0]?.message?.content || ''

  return parseIntentResponse(content)
}

async function detectWithClaude(
  message: string,
  apiKey: string,
  customerContext?: CustomerContext,
  customPrompt?: string
): Promise<DetectedIntent> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      temperature: 0.1,
      system: buildSystemPrompt(customerContext, customPrompt),
      messages: [{ role: 'user', content: message }],
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Claude API ${res.status}: ${body}`)
  }

  const data = await res.json()
  const content = data.content?.[0]?.text || ''

  return parseIntentResponse(content)
}

// ---------------------------------------------------------------------------
// Parse JSON response from AI
// ---------------------------------------------------------------------------

function parseIntentResponse(raw: string): DetectedIntent {
  try {
    // Extract JSON from the response (AI might add extra text)
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON found')

    const parsed = JSON.parse(jsonMatch[0])

    const validActions: IntentAction[] = [
      'CONSULTAR_OS', 'NOVO_ORCAMENTO', 'AGENDAR_COLETA',
      'STATUS_PAGAMENTO', 'FALAR_HUMANO', 'GENERAL',
    ]

    const action = validActions.includes(parsed.action) ? parsed.action : 'GENERAL'
    const confidence = typeof parsed.confidence === 'number'
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0.5

    return {
      action,
      params: parsed.params || {},
      confidence,
    }
  } catch {
    return { action: 'GENERAL', params: {}, confidence: 0.3 }
  }
}

// ---------------------------------------------------------------------------
// Keyword-based fallback (no API key needed)
// ---------------------------------------------------------------------------

const KEYWORD_RULES: Array<{ action: IntentAction; keywords: RegExp; confidence: number }> = [
  {
    action: 'FALAR_HUMANO',
    keywords: /\b(humano|atendente|pessoa|real|falar\s+com\s+algu[eé]m|n[aã]o\s+quero\s+bot|gente)\b/i,
    confidence: 0.9,
  },
  {
    action: 'CONSULTAR_OS',
    keywords: /\b(status|os\s*\d+|ordem\s+de\s+servi[cç]o|como\s+t[aá]|pronto|consert|andamento|minha\s+(impressora|notebook|equipamento)|ficou\s+pronto)\b/i,
    confidence: 0.75,
  },
  {
    action: 'AGENDAR_COLETA',
    keywords: /\b(coleta|buscar|retirar|retirada|agendar|mandar?\s+algu[eé]m|ir\s+buscar|pegar)\b/i,
    confidence: 0.7,
  },
  {
    action: 'NOVO_ORCAMENTO',
    keywords: /\b(consert|arrum|quebr|parou|or[cç]amento|levar|trazer|defeito|problema|n[aã]o\s+funciona|n[aã]o\s+liga|n[aã]o\s+imprime|travando|erro)\b/i,
    confidence: 0.65,
  },
  {
    action: 'STATUS_PAGAMENTO',
    keywords: /\b(pag|valor|pre[cç]o|quanto|boleto|pix|devo|cobran[cç]a|fatura|parcela)\b/i,
    confidence: 0.7,
  },
]

function detectWithKeywords(message: string): DetectedIntent {
  const normalized = message.toLowerCase().trim()

  // Extract OS number if present
  const osMatch = normalized.match(/os\s*#?\s*(\d+)/i) || normalized.match(/(\d{4,6})/g)
  const params: Record<string, any> = {}
  if (osMatch) {
    params.os_number = parseInt(osMatch[1] || osMatch[0], 10)
  }

  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.test(normalized)) {
      return { action: rule.action, params, confidence: rule.confidence }
    }
  }

  return { action: 'GENERAL', params, confidence: 0.5 }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export type AIProvider = 'openai' | 'claude' | 'keywords'

export async function detectIntent(
  message: string,
  options: {
    provider?: AIProvider
    apiKey?: string
    customerContext?: CustomerContext
    customPrompt?: string
  } = {}
): Promise<DetectedIntent> {
  const { provider = 'keywords', apiKey, customerContext, customPrompt } = options

  // Try AI-based detection first
  if (provider === 'openai' && apiKey) {
    try {
      return await detectWithOpenAI(message, apiKey, customerContext, customPrompt)
    } catch (err) {
      console.error('[DetectIntent] OpenAI failed, falling back to keywords:', err)
    }
  }

  if (provider === 'claude' && apiKey) {
    try {
      return await detectWithClaude(message, apiKey, customerContext, customPrompt)
    } catch (err) {
      console.error('[DetectIntent] Claude failed, falling back to keywords:', err)
    }
  }

  // Fallback to keyword matching
  return detectWithKeywords(message)
}
