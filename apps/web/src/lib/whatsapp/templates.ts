const PORTAL_BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://erp.pontualtech.work'

interface TemplateParams {
  customerName: string
  osNumber: number
  companyName: string
  companySlug: string
  osId: string
  value?: number // centavos
  estimatedDelivery?: string // date string
}

function portalLink(p: TemplateParams) {
  return `${PORTAL_BASE}/portal/${p.companySlug}/os/${p.osId}`
}

function fmtValue(cents?: number): string {
  if (!cents) return ''
  return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`
}

export const whatsappTemplates = {
  coletar: (p: TemplateParams) =>
    `Ola, *${p.customerName}*! 👋\n\n` +
    `Sua OS *#${p.osNumber}* foi aberta na *${p.companyName}*.\n` +
    `Enviaremos nosso motorista para coleta do equipamento.\n\n` +
    `📱 Acompanhe pelo portal:\n${portalLink(p)}`,

  orcamento: (p: TemplateParams) =>
    `Ola, *${p.customerName}*! 📋\n\n` +
    `O orcamento da sua OS *#${p.osNumber}* ficou em *${fmtValue(p.value)}*.\n\n` +
    `✅ Aprove ou recuse diretamente pelo portal:\n${portalLink(p)}`,

  aprovado: (p: TemplateParams) =>
    `Ola, *${p.customerName}*! ✅\n\n` +
    `Sua OS *#${p.osNumber}* foi *aprovada*!\n` +
    (p.estimatedDelivery
      ? `📅 Previsao de entrega: *${new Date(p.estimatedDelivery).toLocaleDateString('pt-BR')}*\n\n`
      : '\n') +
    `Acompanhe o andamento:\n${portalLink(p)}`,

  pronto: (p: TemplateParams) =>
    `Ola, *${p.customerName}*! 🎉\n\n` +
    `Sua OS *#${p.osNumber}* esta *pronta*!\n` +
    `Aguardando retirada ou entrega do equipamento.\n\n` +
    `📱 Detalhes no portal:\n${portalLink(p)}`,

  entregue: (p: TemplateParams) =>
    `Ola, *${p.customerName}*! 📦\n\n` +
    `Sua OS *#${p.osNumber}* foi *entregue*.\n` +
    `Obrigado por confiar na *${p.companyName}*! ⭐\n\n` +
    `Avalie nosso servico:\n${portalLink(p)}`,
}

/**
 * Get the right template based on status name
 */
export function getTemplateForStatus(statusName: string): keyof typeof whatsappTemplates | null {
  const name = statusName.toLowerCase()
  if (name.includes('colet')) return 'coletar'
  if (name.includes('orç') || name.includes('orc') || name.includes('aguardando aprov')) return 'orcamento'
  if (name.includes('aprovad')) return 'aprovado'
  if (name.includes('pront') || name.includes('finaliz')) return 'pronto'
  if (name.includes('entreg')) return 'entregue'
  return null
}
