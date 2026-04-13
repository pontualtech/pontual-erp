import { NextRequest, NextResponse } from 'next/server'
import { sendMessageToPhone, isChatwootConfigured } from '@/lib/chatwoot'
import { error, handleError } from '@/lib/api-response'
import { getServerUser } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const user = await getServerUser()
    if (!user) return error('Nao autenticado', 401)

    if (!isChatwootConfigured()) {
      // Silently skip if not configured
      return NextResponse.json({ data: { skipped: true, reason: 'Chatwoot nao configurado' } })
    }

    const { phone, message, inbox_id } = await req.json()

    if (!phone?.trim()) return error('Telefone e obrigatorio', 400)
    if (!message?.trim()) return error('Mensagem e obrigatoria', 400)

    // Normalize phone: ensure +55 prefix
    let normalizedPhone = phone.replace(/\D/g, '')
    if (normalizedPhone.length === 10 || normalizedPhone.length === 11) {
      normalizedPhone = `+55${normalizedPhone}`
    } else if (!normalizedPhone.startsWith('+')) {
      normalizedPhone = `+${normalizedPhone}`
    }

    const result = await sendMessageToPhone(
      normalizedPhone,
      message,
      inbox_id || 4 // Default: Vendas WhatsApp (inbox 4)
    )

    return NextResponse.json({ data: result })
  } catch (err) {
    return handleError(err)
  }
}
