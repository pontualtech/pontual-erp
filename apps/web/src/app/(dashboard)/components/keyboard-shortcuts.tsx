'use client'

import { useKeyboardShortcuts, SHORTCUT_HELP } from '@/lib/use-keyboard-shortcuts'
import { X, Command } from 'lucide-react'

/**
 * Monta os listeners globais de atalhos + modal de ajuda (toggle com ?).
 * UX-3 #1.
 */
export function KeyboardShortcuts() {
  const { showHelp, setShowHelp } = useKeyboardShortcuts()

  if (!showHelp) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="kb-help-title"
      onClick={() => setShowHelp(false)}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl bg-white dark:bg-zinc-900 shadow-2xl"
      >
        <div className="px-5 py-4 border-b border-gray-200 dark:border-zinc-700 flex items-center justify-between">
          <h3 id="kb-help-title" className="font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Command className="h-5 w-5 text-blue-600" />
            Atalhos de teclado
          </h3>
          <button
            type="button"
            onClick={() => setShowHelp(false)}
            aria-label="Fechar ajuda"
            className="p-1 -m-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            Pressione <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-zinc-800 rounded border text-[11px] font-mono">?</kbd> a qualquer momento para abrir esta lista.
          </p>
          <ul className="space-y-2">
            {SHORTCUT_HELP.map((s, i) => (
              <li key={i} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-zinc-800 last:border-0">
                <span className="text-sm text-gray-700 dark:text-gray-300">{s.label}</span>
                <span className="flex items-center gap-1">
                  {s.keys.map((k, j) => (
                    <span key={j} className="flex items-center gap-1">
                      <kbd className="px-2 py-1 bg-gray-100 dark:bg-zinc-800 rounded border border-gray-300 dark:border-zinc-600 text-xs font-mono text-gray-700 dark:text-gray-300 min-w-[24px] text-center">
                        {k}
                      </kbd>
                      {j < s.keys.length - 1 && <span className="text-gray-400 text-xs">+</span>}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
