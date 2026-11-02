// Leitura (pura) da resposta do bulk-reconcile para a tela: nunca mostra sucesso quando nada foi conferido
// ou quando alguma conta voltou com motivo (ex.: vínculo não feito, já conciliada).
export interface RespostaConferencia {
  updated?: number
  ligadas?: number
  erros?: { ar: string; motivo: string }[]
  avisos?: { ar: string; motivo: string }[]
}

// Fix 7 (F7-G, m6/m10): os `avisos` (conferida, mas com algo a resolver — linha livre de mesmo valor, pagamento Asaas
// sem lançamento ou em trânsito) voltam em `avisos` (um por AR) para a tela mostrar como atenção.
export function resultadoConferencia(d: RespostaConferencia | undefined, sucesso: string): { ok: boolean; mensagem: string; avisos?: string[] } {
  const avisos = (d?.avisos ?? []).map((a) => a.motivo)
  const comAvisos = <T extends object>(r: T) => (avisos.length > 0 ? { ...r, avisos } : r)
  const updated = d?.updated ?? 0
  const erros = d?.erros ?? []
  if (updated === 0 || erros.length > 0) {
    const motivos = Array.from(new Set(erros.map((e) => e.motivo))).join('; ') || 'nenhuma conta foi atualizada'
    return comAvisos({ ok: false, mensagem: updated > 0 ? `${updated} ok, ${erros.length} com erro: ${motivos}` : motivos })
  }
  const ligadas = d?.ligadas ?? 0
  if (ligadas === 0) return comAvisos({ ok: true, mensagem: sucesso })
  return comAvisos({ ok: true, mensagem: `${sucesso} · ${ligadas === 1 ? 'ligada ao banco' : `${ligadas} ligadas ao banco`}` })
}

// Fix 3 (F3-H, m4): resposta do Receber/Pagar — com `aviso` (dinheiro já lançado, nada criado nem ligado) a tela mostra
// atenção com o texto do aviso, nunca o 'registrado!' de sucesso.
export function resultadoBaixa(d: { aviso?: string | null } | undefined, sucesso: string): { aviso: boolean; mensagem: string } {
  return d?.aviso ? { aviso: true, mensagem: d.aviso } : { aviso: false, mensagem: sucesso }
}

// Fix 4 (F4-E, m10): resposta do retorno CNAB — os boletos que não entraram (conflito com outra operação) vão em
// `erros`; com algum, a tela avisa para reimportar (é idempotente) e lista '<nosso número> — <motivo>'.
export function resultadoRetornoCnab(d: {
  pagos: number
  rejeitados: number
  erros?: { seuNumero: string; nossoNumero: string; erro: string }[]
}): { aviso: boolean; mensagem: string; naoProcessadas: string[] } {
  const base = `Retorno processado: ${d.pagos} pagos, ${d.rejeitados} rejeitados`
  const naoProcessadas = (d.erros ?? []).map((e) => `${e.nossoNumero || e.seuNumero} — ${e.erro}`)
  return naoProcessadas.length === 0
    ? { aviso: false, mensagem: base, naoProcessadas }
    : { aviso: true, mensagem: `${base} — ${naoProcessadas.length} não processado(s): reimporte o arquivo`, naoProcessadas }
}

// Fix 7 (F7-D): 409 DINHEIRO_JA_LANCADO do Receber — a tela pergunta "é um novo pagamento?" com os lançamentos.
export interface LancamentoJaLancado { id: string; origem: string; valor_centavos: number; data: string; conta: string | null }
export function perguntaDinheiro(
  status: number,
  corpo: { code?: unknown; error?: unknown; lancados?: unknown } | null | undefined,
): { mensagem: string; lancados: LancamentoJaLancado[] } | null {
  if (status !== 409 || !corpo || corpo.code !== 'DINHEIRO_JA_LANCADO') return null
  return { mensagem: String(corpo.error ?? ''), lancados: Array.isArray(corpo.lancados) ? (corpo.lancados as LancamentoJaLancado[]) : [] }
}

// Fix 8 (F8-A): 409 ESTORNO_PERGUNTA do estorno — a tela pergunta se o dinheiro voltou ou continua no banco.
export function perguntaEstorno(
  status: number,
  corpo: { code?: unknown; error?: unknown; lancados?: unknown } | null | undefined,
): { mensagem: string; lancados: LancamentoJaLancado[] } | null {
  if (status !== 409 || !corpo || corpo.code !== 'ESTORNO_PERGUNTA') return null
  return { mensagem: String(corpo.error ?? ''), lancados: Array.isArray(corpo.lancados) ? (corpo.lancados as LancamentoJaLancado[]) : [] }
}

// Fix 10 (F10-D): resposta 200 do estorno — mover_para (engano) ou devolvido; `aviso` = dinheiro externo não tocado.
export function resultadoEstorno(
  d: { ok?: unknown; movido_para?: unknown; aviso?: unknown } | null | undefined,
  oQue: 'Recebimento' | 'Pagamento',
): { mensagem: string; aviso: string | undefined } {
  return {
    mensagem: d?.movido_para ? `${oQue} movido para a conta certa.` : `${oQue} estornado. Status voltou pra PENDENTE.`,
    aviso: typeof d?.aviso === 'string' ? d.aviso : undefined,
  }
}

// Fix 10 (F10-D): contas a pagar em aberto do mesmo fornecedor para o "lançado na conta errada" (sem a própria).
export function opcoesContaCerta(
  lista: { id: string; description: string; total_amount: number; paid_amount: number | null; status: string }[],
  atual: string,
): { id: string; rotulo: string }[] {
  const brl = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`
  return lista
    .filter((a) => a.id !== atual && a.status === 'PENDENTE' && a.total_amount - (a.paid_amount ?? 0) > 0)
    .map((a) => ({ id: a.id, rotulo: `${a.description} — ${brl(a.total_amount - (a.paid_amount ?? 0))} em aberto` }))
}

