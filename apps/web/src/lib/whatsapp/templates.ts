const PORTAL_BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://erp.pontualtech.work'

interface TemplateParams {
  customerName: string
  customerDoc?: string
  osNumber: number
  companyName: string
  companySlug: string
  osId: string
  value?: number // centavos
  estimatedDelivery?: string // date string
  accessToken?: string // magic link token for auto-login
}

function portalLink(p: TemplateParams) {
  const base = `${PORTAL_BASE}/portal/${p.companySlug}/os/${p.osId}`
  if (p.accessToken) return `${base}?access=${p.accessToken}`
  return p.customerDoc ? `${base}?doc=${p.customerDoc}` : base
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

  analise: (p: TemplateParams) =>
    `Ola, *${p.customerName}*! 🔍\n\n` +
    `Recebemos seu equipamento! OS *#${p.osNumber}*.\n` +
    `Nossos tecnicos ja estao analisando.\n\n` +
    `📱 Acompanhe pelo portal:\n${portalLink(p)}`,

  orcamento: (p: TemplateParams) =>
    `Ola, *${p.customerName}*! 🔔\n\n` +
    `Boa noticia! Finalizamos a analise do seu equipamento e o orcamento da OS *#${p.osNumber}* esta pronto.\n\n` +
    `Acesse seu painel para ver o diagnostico, valores detalhados e aprovar com um clique:\n\n` +
    `👉 ${portalLink(p)}\n\n` +
    `_Acesso instantaneo — basta clicar._`,

  aprovado: (p: TemplateParams) =>
    `Ola, *${p.customerName}*! ✅\n\n` +
    `Sua OS *#${p.osNumber}* foi *aprovada* e o reparo ja foi iniciado!\n` +
    (p.estimatedDelivery
      ? `📅 Previsao de entrega: *${new Date(p.estimatedDelivery).toLocaleDateString('pt-BR')}*\n\n`
      : '\n') +
    `Acompanhe o andamento:\n${portalLink(p)}`,

  execucao: (p: TemplateParams) =>
    `Ola, *${p.customerName}*! 🔧\n\n` +
    `O reparo da sua OS *#${p.osNumber}* esta em andamento.\n\n` +
    `📱 Acompanhe pelo portal:\n${portalLink(p)}`,

  aguardando_peca: (p: TemplateParams) =>
    `Ola, *${p.customerName}*! ⏳\n\n` +
    `Estamos aguardando a chegada de pecas para continuar o reparo da OS *#${p.osNumber}*.\n` +
    `Voce sera notificado assim que o servico for retomado.\n\n` +
    `📱 Acompanhe pelo portal:\n${portalLink(p)}`,

  pronto: (p: TemplateParams) =>
    `Ola, *${p.customerName}*! 🎉\n\n` +
    `Sua OS *#${p.osNumber}* esta *pronta*!\n` +
    `Aguardando retirada ou entrega do equipamento.\n\n` +
    `📱 Detalhes no portal:\n${portalLink(p)}`,

  entregue: (p: TemplateParams) =>
    `Ola, *${p.customerName}*! 📦\n\n` +
    `Sua OS *#${p.osNumber}* foi *entregue com sucesso*.\n` +
    `Obrigado por confiar na *${p.companyName}*! ⭐\n\n` +
    `Avalie nosso servico:\n${portalLink(p)}`,

  cancelada: (p: TemplateParams) =>
    `Ola, *${p.customerName}*.\n\n` +
    `Sua OS *#${p.osNumber}* foi *cancelada*.\n` +
    `Se tiver duvidas, entre em contato conosco.\n\n` +
    `📱 Detalhes:\n${portalLink(p)}`,
}

/**
 * Maps ERP internal status names to WhatsApp template keys.
 *
 * CRITICAL: "Entregar Reparado" = equipamento PRONTO (não entregue!)
 * Only exact "Entregue" means actually delivered.
 * Exact matches come first to avoid substring false positives.
 */
export function getTemplateForStatus(statusName: string): keyof typeof whatsappTemplates | null {
  const name = statusName.toLowerCase().trim()

  // Exact matches first (prevents substring false positives)
  if (name === 'coletar') return 'coletar'
  if (name === 'orcar' || name === 'orçar') return 'analise'
  if (name === 'negociar' || name === 'laudo') return null // internal steps, no notification
  if (name === 'aprovado') return 'aprovado'
  if (name === 'entregue') return 'entregue' // ONLY exact "entregue" = delivered

  // Pattern matches (most specific first)
  if (name.includes('aguardando aprov')) return 'orcamento'
  if (name.includes('execu')) return 'execucao'
  if (name.includes('aguardando pec') || name.includes('aguardando peç')) return 'aguardando_peca'
  if (name.includes('entregar reparado') || name.includes('pronto') || name.includes('finaliz')) return 'pronto'
  if (name.includes('cancel')) return 'cancelada'

  return null
}
