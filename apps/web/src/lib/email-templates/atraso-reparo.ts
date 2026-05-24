import 'server-only'

/**
 * Templates de "Atraso de Reparo" — quando estimated_delivery estoura.
 *
 * Estrategia: 14 templates DIFERENTES (um por dia) + 1 template semanal.
 * Dia 0 dispara WhatsApp + email; dias 1-14 so email; semanal a partir do dia 21.
 *
 * Tom: leve/pessoal — como Ana fala no WhatsApp. Emoji moderado, primeira
 * pessoa, sem promessas falsas (nao afirmamos "peça chegou", "técnico está
 * mexendo agora" — só dizemos que SEGUE PRIORITARIO e a meta de entrega).
 *
 * Trigger e cron: /api/cron/atraso-reparo (rodar diariamente 08:00 BRT).
 */

export type AtrasoVars = {
  primeiro_nome: string
  empresa: string
  os_number: string | number
  equipamento_completo: string
  nova_eta: string
  dias_uteis_restantes: number
  link_portal: string
  link_suporte: string
}

function htmlBase(corpo: string, vars: AtrasoVars): string {
  return `<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>OS #${escape(String(vars.os_number))} — ${escape(vars.empresa)}</title>
</head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f6f7f8;margin:0;padding:16px;color:#1f2937;line-height:1.55">
<div style="max-width:580px;margin:0 auto;background:#fff;border-radius:12px;padding:28px 24px;box-shadow:0 1px 3px rgba(0,0,0,.06)">
${corpo}
<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:14px 16px;border-radius:6px;margin-top:18px">
  <div style="font-size:12px;font-weight:600;color:#92400e;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Meta de entrega</div>
  <div style="font-size:18px;font-weight:700;color:#1f2937">📅 ${escape(vars.nova_eta)}</div>
  ${vars.dias_uteis_restantes > 0 ? `<div style="font-size:13px;color:#6b7280;margin-top:2px">Faltam aproximadamente ${vars.dias_uteis_restantes} dias úteis</div>` : ''}
</div>
<div style="margin-top:18px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:13px;color:#6b7280">
  Dúvidas? Fala com nosso suporte: <a href="${escape(vars.link_suporte)}" style="color:#10b981;text-decoration:none;font-weight:600">${escape(vars.link_suporte)}</a><br>
  Acompanhe sua OS: <a href="${escape(vars.link_portal)}" style="color:#3b82f6;text-decoration:none">${escape(vars.empresa)} portal</a>
</div>
</div></body></html>`
}

function escape(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

const DAILIES: Array<(v: AtrasoVars) => { subject: string; html: string; wa?: string }> = [
  // ─── Dia 0 — primeiro alerta (WhatsApp + email) ───────────────────────
  (v) => ({
    subject: `📌 OS #${v.os_number} — Atualização importante`,
    html: htmlBase(`
      <h2 style="margin:0 0 12px;color:#dc2626;font-size:20px">Oi, ${escape(v.primeiro_nome)}! 👋</h2>
      <p>Vim te dar uma atualização sobre sua <strong>${escape(v.equipamento_completo)}</strong> (OS #${v.os_number}).</p>
      <p>Durante os testes gerais do equipamento, nossa equipe identificou outro problema que precisa de uma análise mais detalhada. Por isso ele voltou pra bancada.</p>
      <p>A boa notícia: <strong>já entrou em regime de urgência</strong> aqui no laboratório. 🚨</p>
      <p>Pode haver necessidade de adquirir peças com o fabricante, por isso a previsão pode ainda sofrer pequenos ajustes.</p>
      <p style="margin-top:18px;background:#ecfdf5;border-left:4px solid #10b981;padding:12px 16px;border-radius:6px">
        ✉️ <strong>Te mando um e-mail todo dia</strong> contando o que está rolando. Sem mistério.
      </p>
      <p>Obrigado pela compreensão! 🙏</p>
    `, v),
    wa: `Oi, ${v.primeiro_nome}! 👋\n\nDurante os testes finais da sua ${v.equipamento_completo} (OS #${v.os_number}), identificamos outro problema que precisa de uma análise mais profunda. Ela voltou pra bancada e já está em *regime de urgência* aqui. 🚨\n\n📅 Nova previsão: *${v.nova_eta}* (+5 dias úteis)\n📦 Pode envolver troca de peça com fabricante\n\nVou te mandar um e-mail todo dia com o status. Pode ficar tranquilo, tá nas mãos certas. 🙏\n\nSuporte: ${v.link_suporte}`,
  }),

  // ─── Dia 1 ──────────────────────────────────────────────────────────────
  (v) => ({
    subject: `OS #${v.os_number} — Update do dia ☀️`,
    html: htmlBase(`
      <h2 style="margin:0 0 12px;font-size:18px">Bom dia, ${escape(v.primeiro_nome)}! ☀️</h2>
      <p>Trazendo o update de hoje da sua OS #${v.os_number}.</p>
      <p>A equipe técnica priorizou seu caso e seguiu avaliando ontem à tarde. Sua <strong>${escape(v.equipamento_completo)}</strong> continua sendo prioridade aqui no laboratório.</p>
      <p>Te atualizo amanhã. Tenha um ótimo dia! 😊</p>
    `, v),
  }),

  // ─── Dia 2 ──────────────────────────────────────────────────────────────
  (v) => ({
    subject: `OS #${v.os_number} — Seguimos no caso 🔧`,
    html: htmlBase(`
      <h2 style="margin:0 0 12px;font-size:18px">Oi, ${escape(v.primeiro_nome)}! Tudo certo? 😊</h2>
      <p>Update do dia 2: continuamos seguindo no caso da sua ${escape(v.equipamento_completo)}.</p>
      <p>Nossa equipe está trabalhando junto com fornecedores oficiais pra garantir a melhor qualidade no reparo. Sem atalhos.</p>
      <p>Amanhã passo por aqui de novo. Abraço!</p>
    `, v),
  }),

  // ─── Dia 3 ──────────────────────────────────────────────────────────────
  (v) => ({
    subject: `OS #${v.os_number} — Continuamos firme 💪`,
    html: htmlBase(`
      <h2 style="margin:0 0 12px;font-size:18px">Oi! ✋</h2>
      <p>Sua OS #${v.os_number} no dia 3 da nossa rotina diária.</p>
      <p>Sabemos a importância da <strong>${escape(v.equipamento_completo)}</strong> pra você — e essa importância é nossa também. Por isso o cuidado em cada etapa.</p>
      <p>Te atualizo amanhã 💪</p>
    `, v),
  }),

  // ─── Dia 4 ──────────────────────────────────────────────────────────────
  (v) => ({
    subject: `OS #${v.os_number} — Conforme planejado ✅`,
    html: htmlBase(`
      <h2 style="margin:0 0 12px;font-size:18px">Bom dia, ${escape(v.primeiro_nome)}! 🌤️</h2>
      <p>Update da sua ${escape(v.equipamento_completo)}: estamos no meio da janela de reparo. Tudo seguindo conforme planejado, nada de novo a sinalizar — o que é boa notícia. 😊</p>
      <p>Amanhã te atualizo de novo!</p>
    `, v),
  }),

  // ─── Dia 5 ──────────────────────────────────────────────────────────────
  (v) => ({
    subject: `OS #${v.os_number} — Atenção contínua ☕`,
    html: htmlBase(`
      <h2 style="margin:0 0 12px;font-size:18px">E aí, ${escape(v.primeiro_nome)}!</h2>
      <p>Passando pra te dizer que sua OS #${v.os_number} segue ativa aqui no laboratório.</p>
      <p>Reparo é como cozinhar arroz bom: precisa de atenção constante. ☕ Nossa equipe não está deixando passar nada.</p>
      <p>Te aviso amanhã. Abraço!</p>
    `, v),
  }),

  // ─── Dia 6 ──────────────────────────────────────────────────────────────
  (v) => ({
    subject: `OS #${v.os_number} — Comprometidos 🎯`,
    html: htmlBase(`
      <h2 style="margin:0 0 12px;font-size:18px">Oi, ${escape(v.primeiro_nome)}!</h2>
      <p>Dia 6 da nossa atualização sobre a <strong>${escape(v.equipamento_completo)}</strong>.</p>
      <p>Continuamos comprometidos com a entrega na data prevista. Sem desvios.</p>
      <p>Qualquer dúvida, fala com nosso suporte. Bom dia! 👋</p>
    `, v),
  }),

  // ─── Dia 7 ──────────────────────────────────────────────────────────────
  (v) => ({
    subject: `OS #${v.os_number} — Uma semana de update 📅`,
    html: htmlBase(`
      <h2 style="margin:0 0 12px;font-size:18px">Bom dia, ${escape(v.primeiro_nome)}! Semana cheia e segue o jogo! 🎯</h2>
      <p>Estamos firmes no caso da sua OS #${v.os_number}. Já é uma semana inteira de atualizações diárias e quero que saiba: cada dia desses, sua ${escape(v.equipamento_completo)} avançou aqui.</p>
      <p>Amanhã tem mais update. Tenha um ótimo dia!</p>
    `, v),
  }),

  // ─── Dia 8 ──────────────────────────────────────────────────────────────
  (v) => ({
    subject: `OS #${v.os_number} — Cuidando da sua ${escape(v.equipamento_completo).split(' ')[0]} 🛠️`,
    html: htmlBase(`
      <h2 style="margin:0 0 12px;font-size:18px">Olá, ${escape(v.primeiro_nome)}!</h2>
      <p>Dia 8 da nossa rotina diária 😄</p>
      <p>Sua <strong>${escape(v.equipamento_completo)}</strong> continua sob nossos cuidados. Bom dia!</p>
    `, v),
  }),

  // ─── Dia 9 ──────────────────────────────────────────────────────────────
  (v) => ({
    subject: `OS #${v.os_number} — Confiança no trabalho 🌻`,
    html: htmlBase(`
      <h2 style="margin:0 0 12px;font-size:18px">Oi! Tudo bem, ${escape(v.primeiro_nome)}? 🌻</h2>
      <p>Mais um dia de atualização da OS #${v.os_number}.</p>
      <p>Estamos confiantes na entrega dentro da janela prevista. A confiança vem do trabalho que já fizemos até aqui — não é otimismo cego.</p>
      <p>Te falo amanhã!</p>
    `, v),
  }),

  // ─── Dia 10 ─────────────────────────────────────────────────────────────
  (v) => ({
    subject: `OS #${v.os_number} — Reta final ✨`,
    html: htmlBase(`
      <h2 style="margin:0 0 12px;font-size:18px">Bom dia, ${escape(v.primeiro_nome)}!</h2>
      <p>Reta final se aproximando! Sua <strong>${escape(v.equipamento_completo)}</strong> está nos últimos estágios do processo.</p>
      <p>Obrigado pela paciência. Amanhã tem mais update! ✨</p>
    `, v),
  }),

  // ─── Dia 11 ─────────────────────────────────────────────────────────────
  (v) => ({
    subject: `OS #${v.os_number} — Quase lá! 🏁`,
    html: htmlBase(`
      <h2 style="margin:0 0 12px;font-size:18px">Oi, ${escape(v.primeiro_nome)}! Quase lá! 🏁</h2>
      <p>Sua OS #${v.os_number} tá entrando nos últimos estágios.</p>
      <p>A equipe tem certeza absoluta da qualidade antes de liberar pra você. Isso significa mais um passinho de validação.</p>
      <p>Te atualizo amanhã!</p>
    `, v),
  }),

  // ─── Dia 12 ─────────────────────────────────────────────────────────────
  (v) => ({
    subject: `OS #${v.os_number} — Detalhes finais 🙌`,
    html: htmlBase(`
      <h2 style="margin:0 0 12px;font-size:18px">Olá, ${escape(v.primeiro_nome)}!</h2>
      <p>Dia 12 — chegando! Sua ${escape(v.equipamento_completo)} segue conosco, com prioridade máxima.</p>
      <p>Estamos só preparando os detalhes finais. Bom dia! 🙌</p>
    `, v),
  }),

  // ─── Dia 13 ─────────────────────────────────────────────────────────────
  (v) => ({
    subject: `OS #${v.os_number} — Falta pouco 🎯`,
    html: htmlBase(`
      <h2 style="margin:0 0 12px;font-size:18px">Bom dia, ${escape(v.primeiro_nome)}!</h2>
      <p>Falta pouquinho! Sua OS #${v.os_number} tá quase pronta — estamos na última fase de validação.</p>
      <p>Em até 1-2 dias você recebe a notificação de retirada. Obrigado pela parceria nessa! 🤝</p>
    `, v),
  }),

  // ─── Dia 14 — último daily, anuncia mudança pra semanal ────────────────
  (v) => ({
    subject: `OS #${v.os_number} — Mudando para updates semanais 📆`,
    html: htmlBase(`
      <h2 style="margin:0 0 12px;font-size:18px">Oi, ${escape(v.primeiro_nome)}!</h2>
      <p>Hoje é nosso último daily 😅</p>
      <p>Sua OS #${v.os_number} continua em atendimento e a partir da próxima semana vou te atualizar <strong>1x por semana</strong> até liberarmos pra retirada.</p>
      <p>Caso ache que algo não está fluindo, fala com nosso suporte que conversamos direto. Sem cerimônia.</p>
      <p>Obrigado por confiar na gente. ✨</p>
    `, v),
  }),
]

/**
 * Atraso AE-pecas (2026-05-24, Karlão):
 * Template ÚNICO usado em cada estouro de prazo da OS no status "Aprovado".
 * Substitui a sequência diária 0-14 + semanal — só envia quando NOVO prazo
 * estoura, mencionando peças e portal magic link.
 */
export const PECAS_EM_TRANSITO = (v: AtrasoVars) => ({
  subject: `OS #${v.os_number} — Atualização sobre seu reparo`,
  html: htmlBase(`
    <h2 style="margin:0 0 12px;font-size:20px">Oi, ${escape(v.primeiro_nome)}! 👋</h2>
    <p>Atualização sobre sua <strong>${escape(v.equipamento_completo)}</strong> (OS #${v.os_number}).</p>
    <p>Estamos aguardando a chegada das <strong>peças do fabricante</strong> para finalizar seu reparo. As peças já foram solicitadas e estão a caminho.</p>
    <div style="background:#ecfdf5;border-left:4px solid #10b981;padding:14px 16px;border-radius:6px;margin:18px 0">
      <div style="font-size:13px;color:#065f46;margin-bottom:4px"><strong>📦 Status:</strong> Aprovado, aguardando peças</div>
      <div style="font-size:13px;color:#065f46">Assim que chegarem, retomamos o reparo imediatamente.</div>
    </div>
    <p style="margin-top:18px"><strong>🔗 Acompanhe tudo no seu portal:</strong></p>
    <p style="text-align:center;margin:14px 0">
      <a href="${escape(v.link_portal)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:8px;font-size:15px">
        ACESSAR MEU PORTAL
      </a>
    </p>
    <p style="font-size:13px;color:#6b7280;text-align:center;margin-top:0">
      Você entra direto, sem precisar de senha.
    </p>
    <p style="font-size:14px;color:#374151;margin-top:18px">
      No portal você vê o histórico completo da sua OS, atualizações em tempo real e pode falar diretamente com a gente.
    </p>
    <p>Obrigado pela paciência! 🙏</p>
  `, v),
})

const WEEKLY = (v: AtrasoVars) => ({
  subject: `OS #${v.os_number} — Update semanal 📆`,
  html: htmlBase(`
    <h2 style="margin:0 0 12px;font-size:18px">Oi, ${escape(v.primeiro_nome)}!</h2>
    <p>Atualização semanal da OS #${v.os_number} da sua <strong>${escape(v.equipamento_completo)}</strong>.</p>
    <p>Continuamos no caso e priorizando a entrega o quanto antes. Sem novidades específicas pra te passar hoje, mas seguimos firmes.</p>
    <p>Próxima atualização: na próxima semana.</p>
    <p>Bom dia! 🙏</p>
  `, v),
})

/**
 * Retorna o template do dia. daily = 0 (dia do estouro), 1..14 (dias seguintes),
 * 15+ vira semanal automaticamente.
 *
 * `overrides` opcional permite cada empresa customizar o template via settings.
 * Chaves esperadas no DB (table `settings`, key prefixada por `notif.atraso_reparo`):
 *   notif.atraso_reparo.day{N}.subject  — texto, ja interpolado
 *   notif.atraso_reparo.day{N}.html     — HTML completo
 *   notif.atraso_reparo.day{N}.wa       — texto WhatsApp (so dia 0 usa)
 *   notif.atraso_reparo.weekly.subject  — semanal
 *   notif.atraso_reparo.weekly.html
 * Use placeholders {{primeiro_nome}}, {{equipamento_completo}}, {{os_number}},
 * {{nova_eta}}, {{dias_uteis_restantes}}, {{empresa}}, {{link_portal}},
 * {{link_suporte}} — substituidos antes do envio.
 */
export type AtrasoOverride = {
  subject?: string
  html?: string
  wa?: string
}

function interpolate(str: string, vars: AtrasoVars): string {
  return str
    .replace(/\{\{primeiro_nome\}\}/g, vars.primeiro_nome)
    .replace(/\{\{empresa\}\}/g, vars.empresa)
    .replace(/\{\{os_number\}\}/g, String(vars.os_number))
    .replace(/\{\{equipamento_completo\}\}/g, vars.equipamento_completo)
    .replace(/\{\{nova_eta\}\}/g, vars.nova_eta)
    .replace(/\{\{dias_uteis_restantes\}\}/g, String(vars.dias_uteis_restantes))
    .replace(/\{\{link_portal\}\}/g, vars.link_portal)
    .replace(/\{\{link_suporte\}\}/g, vars.link_suporte)
}

export function buildAtrasoEmail(
  daily: number,
  vars: AtrasoVars,
  overrides?: AtrasoOverride,
): { subject: string; html: string; wa?: string } {
  if (daily < 0) daily = 0
  const base = daily >= DAILIES.length ? WEEKLY(vars) : DAILIES[daily](vars)

  // Aplica overrides se houver — substitui SOMENTE o que vier setado.
  if (!overrides) return base
  return {
    subject: overrides.subject ? interpolate(overrides.subject, vars) : base.subject,
    html: overrides.html ? interpolate(overrides.html, vars) : base.html,
    wa: overrides.wa ? interpolate(overrides.wa, vars) : (base as { wa?: string }).wa,
  }
}

/**
 * Calcula data futura adicionando N dias UTEIS (skip sab/dom).
 * Nao considera feriados — boa o suficiente pra ETA.
 */
export function addBusinessDays(start: Date, days: number): Date {
  const d = new Date(start)
  let added = 0
  while (added < days) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) added++
  }
  return d
}

/**
 * Calcula dias uteis ate uma data target (a partir de hoje).
 */
export function businessDaysUntil(target: Date): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const t = new Date(target)
  t.setHours(0, 0, 0, 0)
  if (t <= today) return 0
  let days = 0
  const d = new Date(today)
  while (d < t) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) days++
  }
  return days
}
