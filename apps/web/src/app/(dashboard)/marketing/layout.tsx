/**
 * Layout do módulo Marketing.
 *
 * Renderiza <GlobalSearch /> no nível do módulo — o componente registra
 * keyboard listener no window (Cmd+K / Ctrl+K) e mostra um modal sobreposto
 * a qualquer página filha (/contatos, /segmentos, /campanhas, /automations).
 *
 * O botão trigger visível fica escondido dentro do componente quando o modal
 * está fechado — pode ser colocado em headers de página filha se quiser.
 * O atalho de teclado funciona em qualquer página do módulo automaticamente.
 */

import { GlobalSearch } from '@/components/marketing/GlobalSearch'

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <GlobalSearch headless />
    </>
  )
}
