import { prisma } from '@pontual/db'

interface SearchResult {
  id: string
  title: string
  content: string
  category: string | null
  relevance: number
}

/**
 * Search knowledge base using text matching.
 * V1: Simple ILIKE search. V2 will use pgvector embeddings.
 */
export async function searchKnowledgeBase(
  companyId: string,
  query: string,
  limit: number = 5
): Promise<SearchResult[]> {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 2)
    .slice(0, 10)

  if (words.length === 0) return []

  // Search documents matching any word in title or content
  const documents = await prisma.aiDocument.findMany({
    where: {
      company_id: companyId,
      OR: words.flatMap(word => [
        { title: { contains: word, mode: 'insensitive' as const } },
        { content: { contains: word, mode: 'insensitive' as const } },
      ]),
    },
    take: limit * 2, // fetch more, then rank
    select: {
      id: true,
      title: true,
      content: true,
      category: true,
    },
  })

  // Simple relevance scoring: count matching words
  const scored = documents.map(doc => {
    const text = `${doc.title} ${doc.content}`.toLowerCase()
    const matchCount = words.filter(w => text.includes(w)).length
    return { ...doc, relevance: matchCount / words.length }
  })

  // Sort by relevance descending, take top N
  return scored
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, limit)
}

/**
 * Build context prompt from search results
 */
export function buildContext(results: SearchResult[]): string {
  if (results.length === 0) return ''

  const sections = results.map((r, i) =>
    `[Fonte ${i + 1}: ${r.title}${r.category ? ` (${r.category})` : ''}]\n${r.content.slice(0, 1500)}`
  )

  return sections.join('\n\n---\n\n')
}

/**
 * System prompt for the RAG chatbot
 */
export function getSystemPrompt(companyName: string, context: string): string {
  const base = `Voce e a assistente tecnica virtual da ${companyName}, especializada em impressoras, notebooks, monitores e scanners.

REGRAS IMPORTANTES:
- Responda APENAS com base nas informacoes do contexto fornecido abaixo.
- Se nao encontrar a resposta no contexto, diga: "Nao encontrei essa informacao na nossa base de conhecimento. Deseja abrir um ticket para falar com um tecnico?"
- Seja educada, profissional e objetiva.
- Use linguagem simples, evite jargao tecnico desnecessario.
- Quando possivel, indique a fonte da informacao.
- Responda em portugues brasileiro.
- NAO invente informacoes. NAO alucine. Se nao sabe, admita.`

  if (context) {
    return `${base}\n\n--- CONTEXTO DA BASE DE CONHECIMENTO ---\n\n${context}`
  }

  return `${base}\n\n[Nenhum documento relevante encontrado na base de conhecimento. Oriente o cliente a abrir um ticket.]`
}
