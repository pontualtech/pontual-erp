import { NextRequest } from 'next/server'
import { prisma } from '@pontual/db'
import { getPortalUserFromRequest } from '@/lib/portal-auth'
import { streamText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { searchKnowledgeBase, buildContext, getSystemPrompt } from '@/lib/ai/rag'

export async function POST(req: NextRequest) {
  try {
    const portalUser = getPortalUserFromRequest(req)
    if (!portalUser) {
      return new Response(JSON.stringify({ error: 'Nao autenticado' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const { messages, session_id } = await req.json()

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'Mensagens obrigatorias' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Get latest user message for RAG search
    const lastUserMsg = [...messages].reverse().find((m: { role: string }) => m.role === 'user')
    if (!lastUserMsg) {
      return new Response(JSON.stringify({ error: 'Mensagem do usuario nao encontrada' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Get company name for system prompt
    const company = await prisma.company.findUnique({
      where: { id: portalUser.company_id },
      select: { name: true },
    })

    // Search knowledge base
    const searchResults = await searchKnowledgeBase(
      portalUser.company_id,
      lastUserMsg.content,
      5
    )

    const context = buildContext(searchResults)
    const systemPrompt = getSystemPrompt(company?.name || 'Empresa', context)

    // Validate session ownership if session_id provided
    if (session_id) {
      const existingSession = await prisma.aiChatSession.findFirst({
        where: { id: session_id, company_id: portalUser.company_id, customer_id: portalUser.customer_id },
      })
      if (!existingSession) {
        return new Response(JSON.stringify({ error: 'Sessao invalida' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // Create or get session
    let sessionId = session_id
    if (!sessionId) {
      const session = await prisma.aiChatSession.create({
        data: {
          company_id: portalUser.company_id,
          customer_id: portalUser.customer_id,
          title: lastUserMsg.content.slice(0, 100),
        },
      })
      sessionId = session.id
    }

    // Save user message
    await prisma.aiChatMessage.create({
      data: {
        session_id: sessionId,
        role: 'user',
        content: lastUserMsg.content,
      },
    })

    // Check if Anthropic API key is configured
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      // Fallback: return a helpful message without AI
      const fallbackMsg = searchResults.length > 0
        ? `Encontrei ${searchResults.length} documento(s) relevante(s):\n\n${searchResults.map((r, i) => `${i + 1}. **${r.title}**\n${r.content.slice(0, 300)}...`).join('\n\n')}\n\n_Para respostas mais inteligentes, configure a chave da API Claude (ANTHROPIC_API_KEY)._`
        : 'Nao encontrei informacoes relevantes na base de conhecimento. Deseja abrir um ticket para falar com um tecnico?'

      await prisma.aiChatMessage.create({
        data: {
          session_id: sessionId,
          role: 'assistant',
          content: fallbackMsg,
          sources: searchResults.map(r => ({ title: r.title, category: r.category })),
        },
      })

      // Return as streaming-compatible response
      return new Response(
        JSON.stringify({ session_id: sessionId, content: fallbackMsg, sources: searchResults.map(r => r.title) }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Stream response from Claude
    const sources = searchResults.map(r => ({ title: r.title, category: r.category }))

    const result = streamText({
      model: anthropic('claude-haiku-4-5-20251001'),
      system: systemPrompt,
      messages: messages.map((m: { role: string; content: string }) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      maxOutputTokens: 1024,
      onFinish: async ({ text }) => {
        // Save assistant message after streaming completes
        await prisma.aiChatMessage.create({
          data: {
            session_id: sessionId,
            role: 'assistant',
            content: text,
            sources,
          },
        }).catch(err => console.error('[AI Chat Save Error]', err))
      },
    })

    // Return streaming response with session_id header
    const response = result.toTextStreamResponse()
    response.headers.set('X-Session-Id', sessionId)
    return response
  } catch (err) {
    console.error('[Portal AI Chat Error]', err)
    return new Response(JSON.stringify({ error: 'Erro interno' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
