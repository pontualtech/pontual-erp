// Leitura (pura) da resposta do bulk-reconcile para a tela: nunca mostra sucesso quando nada foi conferido
// ou quando alguma conta voltou com motivo (ex.: vínculo não feito, já conciliada).
export interface RespostaConferencia {
  updated?: number
  ligadas?: number
  erros?: { ar: string; motivo: string }[]
}

export function resultadoConferencia(d: RespostaConferencia | undefined, sucesso: string): { ok: boolean; mensagem: string } {
  const updated = d?.updated ?? 0
  const erros = d?.erros ?? []
  if (updated === 0 || erros.length > 0) {
    const motivos = Array.from(new Set(erros.map((e) => e.motivo))).join('; ') || 'nenhuma conta foi atualizada'
    return { ok: false, mensagem: updated > 0 ? `${updated} ok, ${erros.length} com erro: ${motivos}` : motivos }
  }
  const ligadas = d?.ligadas ?? 0
  if (ligadas === 0) return { ok: true, mensagem: sucesso }
  return { ok: true, mensagem: `${sucesso} · ${ligadas === 1 ? 'ligada ao banco' : `${ligadas} ligadas ao banco`}` }
}

// Fix 3 (F3-H, m4): resposta do Receber/Pagar — com `aviso` (dinheiro já lançado, nada criado nem ligado) a tela mostra
// atenção com o texto do aviso, nunca o 'registrado!' de sucesso.
export function resultadoBaixa(d: { aviso?: string | null } | undefined, sucesso: string): { aviso: boolean; mensagem: string } {
  return d?.aviso ? { aviso: true, mensagem: d.aviso } : { aviso: false, mensagem: sucesso }
}
