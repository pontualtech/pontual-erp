// "Como o cliente conheceu a empresa?" — perguntado pelo atendente na abertura manual de OS (2026-10-14).
// 75% das OS sem canal de entrada são abertas à mão (telefone, balcão, retorno, indicação); sem esta
// pergunta a maior fonte de clientes novos fica invisível. Fica em custom_data.como_conheceu, separado
// de canal_entrada (que é derivado do rastreio do clique).

export const COMO_CONHECEU_OPTIONS = [
  { key: 'google', label: 'Google / internet' },
  { key: 'maps', label: 'Google Maps' },
  { key: 'indicacao', label: 'Indicação' },
  { key: 'ja_cliente', label: 'Já é cliente' },
  { key: 'email', label: 'E-mail da PontualTech' },
  { key: 'fachada', label: 'Passou na frente da loja' },
  { key: 'redes_sociais', label: 'Instagram / Facebook' },
  { key: 'reclame_aqui', label: 'Reclame Aqui' },
  { key: 'outro', label: 'Outro' },
  { key: 'nao_soube', label: 'Cliente não soube dizer' },
] as const

export type ComoConheceu = (typeof COMO_CONHECEU_OPTIONS)[number]['key']

const KEYS = new Set<string>(COMO_CONHECEU_OPTIONS.map(o => o.key))

/** Aceita só valores da lista; qualquer outra coisa vira null (não grava lixo vindo do cliente HTTP). */
export function normalizeComoConheceu(input: unknown): ComoConheceu | null {
  return typeof input === 'string' && KEYS.has(input) ? (input as ComoConheceu) : null
}
