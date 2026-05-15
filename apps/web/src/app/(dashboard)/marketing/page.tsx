'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Users, BarChart3, FileText, Mail, MousePointerClick, MailX, TrendingUp,
  ArrowRight, Loader2, Megaphone,
} from 'lucide-react'
import { StatCard } from '@/components/marketing/StatCard'
import { formatNumber } from '@/lib/marketing/format'
import { STAGES } from '@/lib/marketing/stages'

interface Stats {
  total: number
  unsubscribed: number
  bounced: number
  segments: { b2c: number; b2b: number }
  stages: Record<string, number>
}

interface ModuleCard {
  title: string
  description: string
  href: string
  icon: typeof Users
  iconBg: string
  iconColor: string
  borderHover: string
  stat?: (s: Stats) => string
}

const MODULES: ModuleCard[] = [
  {
    title: 'Contatos',
    description: 'Base completa de marketing — busca, filtros por funil e Kanban interativo',
    href: '/marketing/contatos',
    icon: Users,
    iconBg: 'bg-blue-50 dark:bg-blue-500/10',
    iconColor: 'text-blue-600 dark:text-blue-400',
    borderHover: 'hover:border-blue-300 dark:hover:border-blue-500/40',
    stat: s => `${formatNumber(s.total)} contatos`,
  },
  {
    title: 'Campanhas',
    description: 'Histórico de envios via Resend com taxas de delivery, opens e cliques',
    href: '/marketing/campanhas',
    icon: BarChart3,
    iconBg: 'bg-purple-50 dark:bg-purple-500/10',
    iconColor: 'text-purple-600 dark:text-purple-400',
    borderHover: 'hover:border-purple-300 dark:hover:border-purple-500/40',
  },
  {
    title: 'Segmentos',
    description: 'Filtros salvos como listas reutilizáveis — compartilhados pela empresa',
    href: '/marketing/segmentos',
    icon: FileText,
    iconBg: 'bg-emerald-50 dark:bg-emerald-500/10',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    borderHover: 'hover:border-emerald-300 dark:hover:border-emerald-500/40',
  },
]

export default function MarketingHomePage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/marketing/contatos/stats')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(j => setStats(j.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <div className="rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 p-2.5 text-white shadow-sm">
          <Megaphone className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            Marketing
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            CRM, campanhas e segmentação de contatos
          </p>
        </div>
      </div>

      {/* Stat cards resumo */}
      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : stats ? (
        <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard
            label="Total de contatos"
            value={stats.total}
            icon={Users}
            tone="default"
            href="/marketing/contatos"
          />
          <StatCard
            label="Cliente atendido"
            value={stats.stages?.cliente_atendido ?? 0}
            hint={`${((stats.stages?.cliente_atendido ?? 0) / Math.max(stats.total, 1) * 100).toFixed(0)}% da base`}
            icon={TrendingUp}
            tone="green"
            href="/marketing/contatos?stage=cliente_atendido"
          />
          <StatCard
            label="Em funil ativo"
            value={(stats.stages?.lead_aguardando ?? 0) + (stats.stages?.em_negociacao ?? 0) + (stats.stages?.cliente_em_servico ?? 0)}
            hint="leads + negociação + serviço"
            icon={MousePointerClick}
            tone="blue"
            href="/marketing/contatos"
          />
          <StatCard
            label="Com bounce / descadastro"
            value={stats.bounced + stats.unsubscribed}
            hint={`${stats.bounced} bounces · ${stats.unsubscribed} desc.`}
            icon={MailX}
            tone={(stats.bounced + stats.unsubscribed) / Math.max(stats.total, 1) > 0.05 ? 'rose' : 'gray'}
          />
        </div>
      ) : null}

      {/* Funnel summary clicável */}
      {stats && (
        <div className="mb-8 rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Funil de marketing
            </h2>
            <Link
              href="/marketing/contatos?view=kanban"
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              Abrir Kanban <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {STAGES.map(s => {
              const count = stats.stages?.[s.key] ?? 0
              const pct = stats.total > 0 ? (count / stats.total) * 100 : 0
              return (
                <Link
                  key={s.key}
                  href={`/marketing/contatos?stage=${s.key}`}
                  className="flex flex-col items-start gap-0.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 transition hover:border-blue-300 hover:bg-white dark:border-gray-700 dark:bg-gray-900/50 dark:hover:border-blue-500/40 dark:hover:bg-gray-900"
                >
                  <span className="flex items-center gap-1.5 text-xs font-medium text-gray-700 dark:text-gray-300">
                    <span>{s.emoji}</span> {s.label}
                  </span>
                  <span className="text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                    {formatNumber(count)}
                  </span>
                  <span className="text-[10px] text-gray-500">{pct.toFixed(1)}%</span>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Módulos */}
      <div>
        <h2 className="mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">
          Módulos
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {MODULES.map(mod => {
            const Icon = mod.icon
            return (
              <Link
                key={mod.title}
                href={mod.href}
                className={`group rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md ${mod.borderHover} dark:border-gray-700 dark:bg-gray-800`}
              >
                <div className="flex items-start gap-3">
                  <div className={`shrink-0 rounded-lg p-2.5 ${mod.iconBg}`}>
                    <Icon className={`h-5 w-5 ${mod.iconColor}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                      {mod.title}
                    </h3>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {mod.description}
                    </p>
                    {stats && mod.stat && (
                      <p className="mt-2 text-xs font-medium text-gray-700 dark:text-gray-300">
                        {mod.stat(stats)}
                      </p>
                    )}
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-gray-300 transition group-hover:translate-x-1 group-hover:text-blue-600" />
                </div>
              </Link>
            )
          })}
        </div>
      </div>

      {/* Webhook status (footer informativo) */}
      <div className="mt-8 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-900/50 dark:bg-blue-500/10 dark:text-blue-300">
        <div className="flex items-center gap-2">
          <Mail className="h-3.5 w-3.5" />
          <span>
            <strong>Tracking automático ativo:</strong> bounces e descadastros do Resend são registrados em tempo real via webhook.
            Tags <code className="rounded bg-blue-100 px-1 dark:bg-blue-500/20">stage:*</code> atualizam automaticamente conforme OS muda de status no ERP.
          </span>
        </div>
      </div>
    </div>
  )
}
