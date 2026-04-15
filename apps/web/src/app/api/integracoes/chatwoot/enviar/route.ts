import { NextRequest, NextResponse } from 'next/server'
import { sendMessageToPhone, isChatwootConfigured } from '@/lib/chatwoot'
import { sendWhatsAppCloud } from '@/lib/whatsapp/cloud-api'
import { error, handleError } from '@/lib/api-response'
import { getServerUser } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const user = await getServerUser()
    if (!user) return error('Nao autenticado', 401)

    const { phone, message, inbox_id } = await req.json()

    if (!phone?.trim()) return error('Telefone e obrigatorio', 400)
    if (!message?.trim()) return error('Mensagem e obrigatoria', 400)

    // Normalize phone: ensure +55 prefix
    let normalizedPhone = phone.replace(/\D/g, '')
    if (normalizedPhone.length === 10 || normalizedPhone.length === 11) {
      normalizedPhone = `55${normalizedPhone}`
    }
    if (!normalizedPhone.startsWith('55')) {
      normalizedPhone = `55${normalizedPhone}`
    }

    // Try WhatsApp Cloud API first (Meta official)
    const cloudResult = await sendWhatsAppCloud(user.companyId, normalizedPhone, message)
    if (cloudResult.success) {
      return NextResponse.json({ data: { sent: true, via: 'cloud_api', messageId: cloudResult.messageId } })
    }

    // Fallback: send via Chatwoot (creates conversation + sends message)
    if (isChatwootConfigured()) {
      const result = await sendMessageToPhone(
        `+${normalizedPhone}`,
        message,
        inbox_id || 10 // Default: Suporte WhatsApp Cloud API inbox
      )
      return NextResponse.json({ data: { sent: true, via: 'chatwoot', ...result } })
    }

    // Both failed
    return NextResponse.json({ data: { sent: false, error: cloudResult.error || 'WhatsApp nao configurado' } })
  } catch (err) {
    return handleError(err)
  }
}
