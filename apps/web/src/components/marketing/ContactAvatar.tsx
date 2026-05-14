'use client'

import { initials, avatarColor } from '@/lib/marketing/format'

interface Props {
  name?: string | null
  email: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
}

export function ContactAvatar({ name, email, size = 'sm' }: Props) {
  const sizeClasses: Record<string, string> = {
    xs: 'h-6 w-6 text-[10px]',
    sm: 'h-8 w-8 text-xs',
    md: 'h-10 w-10 text-sm',
    lg: 'h-14 w-14 text-lg',
  }
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${avatarColor(email)} ${sizeClasses[size]}`}
      title={email}
      aria-label={`Avatar de ${name || email}`}
    >
      {initials(name, email)}
    </div>
  )
}
