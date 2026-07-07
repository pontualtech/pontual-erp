// Guard central de "conta a receber já quitada" — usado por todos os pontos que
// creditam received_amount (maquininha, conciliação OFX, reconcile de webhook,
// bloqueio de nova cobrança no portal).
//
// Por que não basta checar 'RECEBIDO': quando o ADM confere o extrato, o AR é
// promovido RECEBIDO→'LIQUIDADO' (bulk-reconcile); e há linhas legadas 'PAGO'.
// Guards que comparavam só com 'RECEBIDO' deixavam AR LIQUIDADO/PAGO ser
// creditado de novo (double-credit) e rebaixado de status. Ver auditoria 27/06.

export const TERMINAL_RECEIVABLE_STATUSES = ['RECEBIDO', 'LIQUIDADO', 'PAGO'] as const

export function isReceivableSettled(
  ar: { status?: string | null; reconciled?: boolean | null } | null | undefined,
): boolean {
  if (!ar) return false
  if (ar.reconciled === true) return true
  return (TERMINAL_RECEIVABLE_STATUSES as readonly string[]).includes(ar.status || '')
}
