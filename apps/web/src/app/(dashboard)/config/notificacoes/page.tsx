'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import Link from 'next/link'
import { ArrowLeft, Bell, Mail, MessageSquare, Loader2 } from 'lucide-react'

interface NotifConfig {
  email_os_criada: boolean
  email_os_pronta: boolean
  email_os_entregue: boolean
  email_orcamento: boolean
  whatsapp_os_criada: boolean
  whatsapp_os_pronta: boolean
}

export default function NotificacoesPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [config, setConfig] = useState<NotifConfig>({
    email_os_criada: true, email_os_pronta: true, email_os_entregue: true,
    email_orcamento: true, whatsapp_os_criada: false, whatsapp_os_pronta: false,
  })

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(d => {
        const data = d.data || {}
        const flat: Record<string, string> = {}
        for (const group of Object.values(data) as any[]) {
          for (const [key, val] of Object.entries(group)) {
            flat[key] = (val as any)?.value ?? ''
          }
        }
        setConfig(prev => ({
          ...prev,
          email_os_criada: flat['notif.email_os_criada'] !== 'false',
          email_os_pronta: flat['notif.email_os_pronta'] !== 'false',
          email_os_entregue: flat['notif.email_os_entregue'] !== 'false',
          email_orcamento: flat['notif.email_orcamento'] !== 'false',
          whatsapp_os_criada: flat['notif.whatsapp_os_criada'] === 'true',
          whatsapp_os_pronta: flat['notif.whatsapp_os_pronta'] === 'true',
        }))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function toggle(key: keyof NotifConfig) {
    setConfig(prev => ({ ...prev, [key]: !prev[key] }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      const settings = Object.entries(config).map(([key, val]) => ({
        key: `notif.${key}`, value: String(val), type: 'string', group: 'notificacoes',
      }))
      const res = await fetch('/api/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })
      if (!res.ok) throw new Error('Erro ao salvar')
      toast.success('Notificações salvas!')
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Erro') }
    finally { setSaving(false) }
  }

  if (loading) return <div className="py-12 text-center text-gray-400">Carregando...</div>

  const sections = [
    {
      title: 'Email', icon: Mail, color: 'text-blue-600',
      items: [
        { key: 'email_os_criada' as const, label: 'OS criada', desc: 'Enviar email ao cliente quando uma OS é aberta' },
        { key: 'email_os_pronta' as const, label: 'OS pronta', desc: 'Avisar o cliente que o equipamento está pronto' },
        { key: 'email_os_entregue' as const, label: 'OS entregue', desc: 'Confirmação de entrega ao cliente' },
        { key: 'email_orcamento' as const, label: 'Orçamento', desc: 'Enviar orçamento para aprovação do cliente' },
      ],
    },
    {
      title: 'WhatsApp (em breve)', icon: MessageSquare, color: 'text-green-600',
      items: [
        { key: 'whatsapp_os_criada' as const, label: 'OS criada', desc: 'Mensagem automática via WhatsApp' },
        { key: 'whatsapp_os_pronta' as const, label: 'OS pronta', desc: 'Aviso de equipamento pronto via WhatsApp' },
      ],
    },
  ]

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Link href="/config" className="rounded-md border p-2 hover:bg-gray-50"><ArrowLeft className="h-4 w-4" /></Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Notificações</h1>
          <p className="text-sm text-gray-500">Configurar envio automático de emails e mensagens</p>
        </div>
      </div>

      {sections.map(section => {
        const Icon = section.icon
        return (
          <div key={section.title} className="rounded-lg border bg-white overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 bg-gray-50 border-b">
              <Icon className={`h-4 w-4 ${section.color}`} />
              <span className="font-medium text-gray-900 text-sm">{section.title}</span>
            </div>
            <div className="divide-y">
              {section.items.map(item => (
                <label key={item.key} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 cursor-pointer">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{item.label}</p>
                    <p className="text-xs text-gray-500">{item.desc}</p>
                  </div>
                  <div className="relative">
                    <input type="checkbox" checked={config[item.key]} onChange={() => toggle(item.key)}
                      className="sr-only peer" />
                    <div className="w-9 h-5 bg-gray-200 peer-checked:bg-blue-600 rounded-full transition-colors" />
                    <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow peer-checked:translate-x-4 transition-transform" />
                  </div>
                </label>
              ))}
            </div>
          </div>
        )
      })}

      <div className="flex gap-3">
        <Link href="/config" className="px-5 py-2.5 border rounded-md text-gray-700 hover:bg-gray-50">Voltar</Link>
        <button type="button" onClick={handleSave} disabled={saving}
          className="flex-1 py-2.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium flex items-center justify-center gap-2">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {saving ? 'Salvando...' : 'Salvar Notificações'}
        </button>
      </div>
    </div>
  )
}
