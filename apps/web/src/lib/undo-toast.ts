'use client'

import { toast } from 'sonner'

/**
 * UX-5 #4: padrão "undo" universal — substitui `toast.success` em ações
 * destrutivas/reversíveis. Mostra toast com botão "Desfazer" por 5s antes
 * do efeito real propagar.
 *
 * Uso típico:
 *
 *   const ok = await deleteItem(id)  // soft delete (mark deleted=true)
 *   if (ok) {
 *     undoToast({
 *       message: 'Item removido',
 *       onUndo: () => restoreItem(id),  // unmark deleted=false
 *       duration: 5000,
 *     })
 *   }
 *
 * Convenções:
 * - Backend deve fazer SOFT delete (mark `deleted_at`); cron permanente
 *   roda depois pra hard-delete depois de N min.
 * - Se ação não é reversível, NÃO use undoToast — use `toast.success` simples.
 *
 * Exemplo de soft-delete com hard-delete agendado em 30s (worker cleanup):
 *   await prisma.os.update({ where: { id }, data: { deleted_at: new Date() } })
 *   // worker varre `deleted_at < now() - interval '30s'` e remove
 */
export function undoToast({
  message,
  description,
  onUndo,
  duration = 5000,
  icon,
}: {
  message: string
  description?: string
  onUndo: () => void | Promise<void>
  duration?: number
  icon?: string
}) {
  toast(message, {
    description,
    duration,
    icon,
    action: {
      label: 'Desfazer',
      onClick: () => {
        try {
          const result = onUndo()
          if (result instanceof Promise) {
            result.then(() => toast.success('Ação desfeita'))
              .catch((err) => toast.error(`Erro ao desfazer: ${err?.message || 'desconhecido'}`))
          } else {
            toast.success('Ação desfeita')
          }
        } catch (err: any) {
          toast.error(`Erro ao desfazer: ${err?.message || 'desconhecido'}`)
        }
      },
    },
  })
}
