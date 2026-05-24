/**
 * Wave AG (2026-05-24, Karlão): editor de blocos visuais pra templates de email.
 *
 * Karlão reclamou que editar HTML cru no /config/lembrete-orcamento e similares
 * era impraticável pra um humano. Em vez de migrar pra novo formato de storage,
 * a UI passa a editar BLOCOS estruturados e o renderer gera o HTML completo no
 * momento de salvar — mantém compat 100% com sistema de envio existente.
 *
 * Fluxo:
 *   UI editor de blocos → renderEmailFromBlocks(blocks) → HTML completo →
 *   salva no Setting/MessageTemplate (mesma key, mesmo formato) → envio normal.
 *
 * Variáveis (ex: {{customer_name}}) ficam dentro dos campos texto dos blocos.
 * Renderer NÃO substitui — quem substitui é o sender (replaceTemplateVars).
 */

export interface EmailBlocks {
  version: 1
  header: {
    title: string           // ex: "Orçamento Pendente"
    subtitle?: string       // ex: "{{company_name}}" — vira a sigla/nome no topo
    emoji?: string          // ex: "📋"
  }
  greeting?: string         // ex: "Oi, {{customer_name}}! 👋"
  paragraphs: string[]      // parágrafos livres, cada um vira um <p>
  highlight_box?: {
    style: 'info' | 'warning' | 'success'  // azul / âmbar / verde
    title?: string
    text: string
  }
  cta_button?: {
    text: string            // ex: "ACESSAR MEU PORTAL"
    url: string             // ex: "{{portal_link}}" — pode ser variavel
    style: 'primary' | 'success'  // azul / verde
  }
  secondary_text?: string   // texto pós-CTA
  closing?: string          // ex: "Obrigado! 🙏"
  signature?: {
    company_name: string    // ex: "{{company_name}}"
    company_subtitle?: string  // ex: "Assistência Técnica em Informática"
    company_phone?: string  // ex: "{{company_phone}}"
    disclaimer?: string     // ex: "⚙️ Esta é uma mensagem automática..."
  }
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

function paragraphHtml(text: string): string {
  // Preserva quebras de linha — \n vira <br>
  const escaped = escapeHtml(text).replace(/\n/g, '<br>')
  return `<p style="margin:0 0 16px;font-size:14px;color:#475569;line-height:1.7">${escaped}</p>`
}

const HIGHLIGHT_STYLES = {
  info:    { bg: '#eff6ff', border: '#bfdbfe', text: '#1e40af' },
  warning: { bg: '#fef3c7', border: '#fde68a', text: '#92400e' },
  success: { bg: '#ecfdf5', border: '#a7f3d0', text: '#065f46' },
}

const BUTTON_STYLES = {
  primary: { bg: '#2563eb', hoverBg: '#1d4ed8' },
  success: { bg: '#22c55e', hoverBg: '#16a34a' },
}

export function renderEmailFromBlocks(blocks: EmailBlocks): string {
  const h = blocks.header
  const headerEmoji = h.emoji ? `<div style="font-size:28px;margin-bottom:8px">${escapeHtml(h.emoji)}</div>` : ''
  const headerTitle = `<h1 style="margin:0 0 4px;color:#fff;font-size:22px;font-weight:800">${escapeHtml(h.title)}</h1>`
  const headerSubtitle = h.subtitle ? `<p style="margin:0;color:rgba(255,255,255,0.7);font-size:12px">${escapeHtml(h.subtitle)}</p>` : ''

  const greeting = blocks.greeting
    ? `<p style="margin:0 0 16px;font-size:16px;color:#1e293b"><strong>${escapeHtml(blocks.greeting)}</strong></p>`
    : ''

  const paragraphsHtml = blocks.paragraphs.map(paragraphHtml).join('\n')

  let highlightHtml = ''
  if (blocks.highlight_box) {
    const hb = blocks.highlight_box
    const c = HIGHLIGHT_STYLES[hb.style]
    const title = hb.title ? `<div style="font-size:13px;font-weight:700;color:${c.text};margin-bottom:4px">${escapeHtml(hb.title)}</div>` : ''
    highlightHtml = `
      <div style="background:${c.bg};border-left:4px solid ${c.border};padding:14px 16px;border-radius:6px;margin:18px 0">
        ${title}
        <div style="font-size:13px;color:${c.text};line-height:1.55">${escapeHtml(hb.text).replace(/\n/g, '<br>')}</div>
      </div>`
  }

  let ctaHtml = ''
  if (blocks.cta_button) {
    const cta = blocks.cta_button
    const bs = BUTTON_STYLES[cta.style]
    ctaHtml = `
      <p style="text-align:center;margin:24px 0">
        <a href="${escapeHtml(cta.url)}" style="display:inline-block;background:${bs.bg};color:#fff;text-decoration:none;font-weight:700;padding:14px 32px;border-radius:8px;font-size:15px;box-shadow:0 4px 12px rgba(0,0,0,0.1)">
          ${escapeHtml(cta.text)}
        </a>
      </p>`
  }

  const secondary = blocks.secondary_text
    ? `<p style="font-size:13px;color:#6b7280;text-align:center;margin:0 0 18px;line-height:1.6">${escapeHtml(blocks.secondary_text).replace(/\n/g, '<br>')}</p>`
    : ''

  const closing = blocks.closing
    ? `<p style="margin:18px 0 0;font-size:14px;color:#374151">${escapeHtml(blocks.closing).replace(/\n/g, '<br>')}</p>`
    : ''

  let signatureHtml = ''
  if (blocks.signature) {
    const sig = blocks.signature
    const subtitle = sig.company_subtitle ? `<p style="margin:0 0 4px;font-size:11px;color:#94a3b8">${escapeHtml(sig.company_subtitle)}</p>` : ''
    const phone = sig.company_phone ? `<p style="margin:0 0 4px;font-size:11px;color:#94a3b8">Tel: ${escapeHtml(sig.company_phone)}</p>` : ''
    const disclaimer = sig.disclaimer
      ? `<div style="border-top:1px solid #334155;padding-top:10px;margin-top:10px"><p style="margin:0;font-size:10px;color:#64748b">${escapeHtml(sig.disclaimer)}</p></div>`
      : ''
    signatureHtml = `
      <tr>
        <td style="background:#1e293b;padding:24px 32px;text-align:center">
          <p style="margin:0 0 4px;font-size:14px;font-weight:700;color:#fff">${escapeHtml(sig.company_name)}</p>
          ${subtitle}
          ${phone}
          ${disclaimer}
        </td>
      </tr>`
  }

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:32px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
        <tr><td style="background:linear-gradient(135deg,#1e40af 0%,#2563eb 50%,#3b82f6 100%);padding:36px 32px;text-align:center">
          ${headerEmoji}
          ${headerTitle}
          ${headerSubtitle}
        </td></tr>
        <tr><td style="padding:32px">
          ${greeting}
          ${paragraphsHtml}
          ${highlightHtml}
          ${ctaHtml}
          ${secondary}
          ${closing}
        </td></tr>
        ${signatureHtml}
      </table>
    </td></tr>
  </table>
</body></html>`
}

/**
 * Blocks default pra lembrete-orçamento (espelha visual do template HTML atual).
 * Karlão pode editar via UI; estes valores apenas alimentam o estado inicial.
 */
/**
 * Wave AG-2 (2026-05-24): persistencia "self-contained" — embute os blocos
 * JSON em comentario HTML dentro do proprio template. Vantagem: nao precisa
 * mudar backend (1 setting only), e ao recarregar a UI consegue voltar ao
 * editor visual com fidelidade total.
 *
 * Convencao: `<!-- BLOCKS:{...json...} -->` no topo da `<head>` do template.
 */

const BLOCKS_COMMENT_PREFIX = '<!-- BLOCKS:'
const BLOCKS_COMMENT_SUFFIX = ' -->'

export function embedBlocksInHtml(html: string, blocks: EmailBlocks): string {
  // Remove qualquer comentario BLOCKS anterior antes de re-embutir
  const cleaned = stripBlocksComment(html)
  const comment = `${BLOCKS_COMMENT_PREFIX}${JSON.stringify(blocks)}${BLOCKS_COMMENT_SUFFIX}\n`
  // Insere logo apos a tag <head>
  const headOpenIdx = cleaned.indexOf('<head>')
  if (headOpenIdx >= 0) {
    const insertAt = headOpenIdx + '<head>'.length
    return cleaned.slice(0, insertAt) + '\n' + comment + cleaned.slice(insertAt)
  }
  // Sem <head> — preprend logo apos <!DOCTYPE...>
  const doctypeMatch = cleaned.match(/<!DOCTYPE[^>]*>/i)
  if (doctypeMatch) {
    return cleaned.slice(0, doctypeMatch[0].length) + '\n' + comment + cleaned.slice(doctypeMatch[0].length)
  }
  return comment + cleaned
}

export function extractBlocksFromHtml(html: string): EmailBlocks | null {
  // [\s\S] em vez de . com flag /s — compatibilidade com targets ES2017-
  const m = html.match(/<!--\s*BLOCKS:([\s\S]+?)\s*-->/)
  if (!m) return null
  try {
    const parsed = JSON.parse(m[1])
    if (parsed?.version === 1) return parsed as EmailBlocks
  } catch { /* HTML legacy ou comentario corrompido */ }
  return null
}

export function stripBlocksComment(html: string): string {
  return html.replace(/<!--\s*BLOCKS:[\s\S]+?-->\s*\n?/g, '')
}

export const DEFAULT_QUOTE_REMINDER_BLOCKS: EmailBlocks = {
  version: 1,
  header: {
    emoji: '📋',
    title: 'Orçamento Pendente',
    subtitle: '{{company_name}}',
  },
  greeting: 'Prezado(a) {{customer_name}},',
  paragraphs: [
    'O orçamento da sua OS-{{os_number}} está aguardando sua aprovação há {{days_waiting}} dias.',
    'Equipamento: {{equipment}}\nDiagnóstico: {{diagnosis}}',
  ],
  highlight_box: {
    style: 'info',
    title: 'Orçamento pendente',
    text: 'Acesse o painel para ver os valores detalhados e aprovar.',
  },
  cta_button: {
    text: 'ACESSAR MEU PORTAL',
    url: '{{portal_os_link}}',
    style: 'success',
  },
  secondary_text: 'Você entra direto, sem precisar de senha.',
  closing: 'Obrigado pela atenção! 🙏',
  signature: {
    company_name: '{{company_name}}',
    company_subtitle: 'Assistência Técnica em Informática',
    company_phone: '{{company_phone}}',
    disclaimer: '⚙️ Esta é uma mensagem automática. Não responda diretamente este email.',
  },
}
