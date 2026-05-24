/**
 * Wave AB (2026-05-24): helpers compartilhados pra exibição de payment_method e descrição
 * de ARs/APs. Centraliza a tradução de aliases (DEBIT_CARD vs Cartão Débito vindos do
 * motorista app vs balcão) e limpeza de UUIDs técnicos das descrições.
 *
 * Usado em: CR detalhe, CP detalhe, CR listagem, CP listagem.
 */

import { CreditCard, QrCode, FileBarChart, Coins, Landmark, Smartphone } from 'lucide-react'

export interface PaymentVisual {
  icon: any
  color: string
}

// Tabela de visuais — cor + ícone Lucide casados com o name (case-insensitive).
// Formas customizadas que não casam caem no fallback genérico (cinza + CreditCard).
const PAYMENT_VISUALS: { match: string[]; visual: PaymentVisual }[] = [
  { match: ['PIX'], visual: { icon: QrCode, color: 'text-green-600 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-950 dark:border-green-800' } },
  { match: ['Boleto'], visual: { icon: FileBarChart, color: 'text-orange-600 bg-orange-50 border-orange-200 dark:text-orange-400 dark:bg-orange-950 dark:border-orange-800' } },
  { match: ['Cartão Crédito', 'Cartao Credito', 'Cartão Credito'], visual: { icon: CreditCard, color: 'text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-950 dark:border-blue-800' } },
  { match: ['Cartão Débito', 'Cartao Debito', 'Cartão Debito'], visual: { icon: CreditCard, color: 'text-indigo-600 bg-indigo-50 border-indigo-200 dark:text-indigo-400 dark:bg-indigo-950 dark:border-indigo-800' } },
  { match: ['Dinheiro'], visual: { icon: Coins, color: 'text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-950 dark:border-emerald-800' } },
  { match: ['Transferência', 'Transferencia'], visual: { icon: Landmark, color: 'text-purple-600 bg-purple-50 border-purple-200 dark:text-purple-400 dark:bg-purple-950 dark:border-purple-800' } },
  { match: ['Link de Pagamento', 'Link Pagamento'], visual: { icon: Smartphone, color: 'text-pink-600 bg-pink-50 border-pink-200 dark:text-pink-400 dark:bg-pink-950 dark:border-pink-800' } },
]

const FALLBACK_VISUAL: PaymentVisual = {
  icon: CreditCard,
  color: 'text-gray-600 bg-gray-50 border-gray-200 dark:text-gray-400 dark:bg-gray-800 dark:border-gray-700',
}

export function getPaymentVisual(name: string | null | undefined): PaymentVisual | null {
  if (!name) return null
  const pretty = prettyPaymentMethod(name)
  const match = PAYMENT_VISUALS.find(v => v.match.some(m => m.toLowerCase() === pretty.toLowerCase()))
  return match?.visual || FALLBACK_VISUAL
}

// Motorista app salva upper-case underscored. Balcão salva já formatado.
// Normaliza pra exibir bonito sem perder dado original.
const PAYMENT_METHOD_DISPLAY: Record<string, string> = {
  DEBIT_CARD: 'Cartão Débito',
  CREDIT_CARD: 'Cartão Crédito',
  PIX: 'PIX',
  PIX_CODE: 'PIX',
  MONEY: 'Dinheiro',
  MONEY_CASH: 'Dinheiro',
  CASH: 'Dinheiro',
  BOLETO: 'Boleto',
  BANK_SLIP: 'Boleto',
  TRANSFER: 'Transferência',
  BANK_TRANSFER: 'Transferência',
}

export function prettyPaymentMethod(pm: string | null | undefined): string {
  if (!pm) return '—'
  const upper = pm.toUpperCase()
  return PAYMENT_METHOD_DISPLAY[upper] || pm
}

// Remove o sufixo técnico "[EVENT:uuid]" que o motorista app inclui na descrição
// da AR pra dedup. Visualmente não interessa pro usuário — só polui.
export function cleanDescription(d: string | null | undefined): string {
  if (!d) return ''
  return d.replace(/\s*\[event:[^\]]+\]\s*/gi, '').trim()
}
