/**
 * Relatório Diário do Comandante (12/09/2026) — helpers puros do briefing.
 *
 * Email único às 08h com a saúde das duas empresas nas últimas 24h: bots
 * (conversas/erros/watchdog), operação (OS novas e prontas), financeiro
 * (conciliação pendente) e infra (probes). Termina com fecho lúdico + hora
 * de execução (regra da casa: feedback_varredura_timestamp).
 */
export type InfraProbe = { nome: string; ok: boolean }
export type EmpresaBriefing = {
  nome: string
  bots: { conversas: number; turnos: number; erros: number; transferidos: number }
  watchdog: { redispatches: number; alertas: number }
  os: { criadas24h: number; prontasAguardando: number }
  financeiro: { concHigh: number; concWatch: number }
}
export type BriefingData = { geradoEm: string; empresas: EmpresaBriefing[]; infra: InfraProbe[] }

export function probeStatus(infra: InfraProbe[]): '🟢' | '🔴' {
  return infra.every(p => p.ok) ? '🟢' : '🔴'
}

const td = 'padding:4px 10px;border-bottom:1px solid #eee'

export function buildBriefingHtml(d: BriefingData): string {
  const temAlerta = d.empresas.some(e => e.watchdog.alertas > 0)
  const infraOk = probeStatus(d.infra) === '🟢'

  const empresaBloco = (e: EmpresaBriefing) => `
    <h2 style="margin:18px 0 6px;font-size:16px">🏢 ${e.nome}</h2>
    <table style="border-collapse:collapse;font-size:13px;width:100%">
      <tr><td style="${td}">🤖 <strong>Bots</strong></td><td style="${td}">${e.bots.conversas} conversas · ${e.bots.turnos} mensagens · ${e.bots.erros} erro(s) · ${e.bots.transferidos} p/ humano</td></tr>
      <tr><td style="${td}">🛟 Watchdog</td><td style="${td}">${e.watchdog.redispatches} resgate(s) automático(s)${e.watchdog.alertas > 0 ? ` · <strong style="color:#b91c1c">🚨 ${e.watchdog.alertas} alerta(s) exigiram humano — conferir Chatwoot</strong>` : ' · nenhum alerta'}</td></tr>
      <tr><td style="${td}">🛠️ <strong>Operação</strong></td><td style="${td}">${e.os.criadas24h} OS nova(s) nas 24h · <strong>${e.os.prontasAguardando} pronta(s) aguardando entrega/retirada</strong></td></tr>
      <tr><td style="${td}">💰 <strong>Financeiro</strong></td><td style="${td}">conciliação pendente: ${e.financeiro.concHigh > 0 ? `<strong style="color:#b91c1c">${e.financeiro.concHigh} de risco</strong>` : '0 de risco'} + ${e.financeiro.concWatch} a conferir</td></tr>
    </table>`

  const infraLinhas = d.infra.map(p =>
    `<tr><td style="${td}">${p.ok ? '🟢' : '🔴'} ${p.nome}</td><td style="${td}">${p.ok ? 'no ar' : '<strong style="color:#b91c1c">FORA DO AR — verificar!</strong>'}</td></tr>`
  ).join('')

  const fecho = !infraOk
    ? '🚨 Mar agitado hoje, Comandante — tem serviço fora do ar lá em cima. Vale olhar antes do café.'
    : temAlerta
      ? '⚠️ Ventos cruzados: o watchdog precisou chamar reforço humano. De resto, seguimos navegando. 🫡'
      : '⛵ Céu limpo e mar calmo, Comandante — os robôs seguraram o leme a noite toda. Bom dia e boas vendas! 🫡'

  return `
    <p style="font-size:14px">Bom dia, Comandante! Relatório das últimas 24 horas do império. 🚢</p>
    ${d.empresas.map(empresaBloco).join('')}
    <h2 style="margin:18px 0 6px;font-size:16px">🖥️ Infra</h2>
    <table style="border-collapse:collapse;font-size:13px;width:100%">${infraLinhas}</table>
    <p style="margin-top:18px;font-size:13px">${fecho}</p>
    <p style="font-size:11px;color:#777">Varredura executada em ${d.geradoEm} · Relatório Diário do Comandante</p>`
}
