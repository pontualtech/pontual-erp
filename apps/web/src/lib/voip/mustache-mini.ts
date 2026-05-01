/**
 * Mustache mini — suporta apenas o subset necessario pros templates Asterisk:
 *   {{var}}             -- substituicao escapada (no templates Asterisk: nao escapa, eh config)
 *   {{#section}}...{{/section}}     -- iteracao de array OU truthy check
 *   {{^section}}...{{/section}}     -- inverted (false/null/empty array)
 *
 * SEM dependencia externa pra evitar add ~200KB de mustache.js.
 *
 * Limitacoes: nao suporta partials ({{>name}}), lambdas, ou comments.
 */

type Context = Record<string, unknown> | unknown

function lookup(ctx: Context, key: string): unknown {
  if (ctx == null) return undefined
  if (key === '.') return ctx
  if (typeof ctx !== 'object') return undefined
  return (ctx as Record<string, unknown>)[key]
}

function isTruthy(v: unknown): boolean {
  if (v == null || v === false || v === 0 || v === '') return false
  if (Array.isArray(v) && v.length === 0) return false
  return true
}

export function render(template: string, context: Context): string {
  // Process sections first (greedy outer first via recursion):
  const sectionRegex = /{{([#^])([\w.]+)}}([\s\S]*?){{\/\2}}/g
  let out = template

  // Loop until no more sections (handles nesting via fixed-point)
  let prev: string | null = null
  while (prev !== out) {
    prev = out
    out = out.replace(sectionRegex, (_m, kind, name, body) => {
      const val = lookup(context, name)
      const inverted = kind === '^'
      if (inverted) {
        return isTruthy(val) ? '' : render(body, context)
      }
      // Section: if array, repeat with each item as context
      if (Array.isArray(val)) {
        return val.map(item => render(body, item)).join('')
      }
      // If truthy primitive/object, render with merged context
      if (isTruthy(val)) {
        const subCtx = typeof val === 'object' ? { ...(context as object), ...(val as object) } : context
        return render(body, subCtx)
      }
      return ''
    })
  }

  // Variable replacement
  return out.replace(/{{([\w.]+)}}/g, (_m, name) => {
    const v = lookup(context, name)
    if (v == null) return ''
    return String(v)
  })
}
