// Token HMAC pro link /cupom-avaliacao/[token] — cliente clica, ganha cupom 10%,
// vai pro Google. Usado em 2 lugares:
//   - Cron google-reviews (envia link via WhatsApp/email pos-entrega)
//   - GET /api/portal/os/[id] (embute review_url no payload pra UI portal renderizar)
//
// Verificacao do token e feita em /app/cupom-avaliacao/[token]/route.ts.
// SECRET sem fallback hardcoded (audit C9): throw em vez de aceitar token forjado.

import crypto from 'crypto'

export function buildCouponToken(companyId: string, customerId: string): string {
  const secret = process.env.ERP_TOKEN_SECRET || process.env.CRON_SECRET
  if (!secret) {
    throw new Error('ERP_TOKEN_SECRET (ou CRON_SECRET fallback) ausente — configurar no Coolify')
  }
  const payload = Buffer.from(JSON.stringify({ c: companyId, u: customerId, t: Date.now() })).toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${sig}`
}
