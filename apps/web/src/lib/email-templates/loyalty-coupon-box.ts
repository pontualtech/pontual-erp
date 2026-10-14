// Quadro "presente de fidelidade" do e-mail de OS entregue (2026-10-14). O cupom é dado a todo cliente
// na entrega (lib/loyalty/delivery-coupon) e antes ninguém avisava — dos 226 cupons criados, 1 foi usado.
// NUNCA citar avaliação aqui: cupom ligado a avaliação é proibido pelo Google. Só e-mail — no WhatsApp,
// texto com desconto vira MARKETING na Meta (desligado após a restrição por spam de 09/10).

export function loyaltyCouponBoxHtml(percent: number): string {
  const pct = Math.round(percent)
  return `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px;margin:0 0 24px;">
            <p style="margin:0 0 4px;font-size:14px;color:#166534;font-weight:700;">&#127873; Presente de fidelidade: ${pct}% de desconto</p>
            <p style="margin:0;font-size:13px;color:#166534;line-height:1.5;">Vale no seu próximo conserto ou manutenção. Não precisa guardar código: o desconto já está no seu cadastro, é só nos chamar quando precisar.</p>
          </div>`
}
