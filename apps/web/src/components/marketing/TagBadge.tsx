'use client'

import { humanizeTag, tagColorClasses, type TagDescriptor } from '@/lib/marketing/tags'

interface Props {
  tag: string | TagDescriptor
  size?: 'sm' | 'md'
  showEmoji?: boolean
}

export function TagBadge({ tag, size = 'sm', showEmoji = true }: Props) {
  const t = typeof tag === 'string' ? humanizeTag(tag) : tag
  if (t.hidden) return null

  const sizeClasses = size === 'md'
    ? 'px-2.5 py-1 text-xs'
    : 'px-2 py-0.5 text-[11px]'

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${sizeClasses} ${tagColorClasses(t.color)}`}
      title={t.raw}
    >
      {showEmoji && t.emoji && <span className="leading-none">{t.emoji}</span>}
      {t.label}
    </span>
  )
}

interface ListProps {
  tags: string[]
  size?: 'sm' | 'md'
  showEmoji?: boolean
  max?: number
}

export function TagList({ tags, size = 'sm', showEmoji = true, max }: ListProps) {
  const descriptors = tags.map(t => (typeof t === 'string' ? humanizeTag(t) : t)).filter(t => !t.hidden)
  const kindOrder: Record<string, number> = { stage: 0, segment: 1, origin: 2, year: 3 }
  descriptors.sort((a, b) => (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9))

  const visible = max ? descriptors.slice(0, max) : descriptors
  const overflow = max && descriptors.length > max ? descriptors.length - max : 0

  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map(t => <TagBadge key={t.raw} tag={t} size={size} showEmoji={showEmoji} />)}
      {overflow > 0 && (
        <span className="text-[11px] text-gray-400">+{overflow}</span>
      )}
    </div>
  )
}
