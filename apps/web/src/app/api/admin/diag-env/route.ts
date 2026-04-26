import { NextResponse } from 'next/server'
// TEMP: endpoint pra confirmar se INTERNAL_API_KEY foi carregada no container.
// Nao retorna o valor — so se existe e tamanho. Apagar depois do uso.
export async function GET() {
  const k = process.env.INTERNAL_API_KEY || ''
  const k2 = process.env.BOT_WEBHOOK_SECRET || ''
  return NextResponse.json({
    has_internal_api_key: !!k,
    internal_api_key_len: k.length,
    has_bot_webhook_secret: !!k2,
    bot_webhook_secret_len: k2.length,
    node_env: process.env.NODE_ENV,
  })
}
