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
