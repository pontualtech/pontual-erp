'use client'

import Link from 'next/link'
import { Building2, Users, Shield, Tag, Wrench, Bell, Database, Palette, Landmark, FileText, PrinterIcon, FileKey, MessageSquare } from 'lucide-react'

const sections = [
  {
    title: 'Empresa',
    items: [
      { label: 'Dados da Empresa', href: '/config/empresa', icon: Building2, desc: 'CNPJ, endereco, logo, dados fiscais' },
      { label: 'Usuarios', href: '/config/usuarios', icon: Users, desc: 'Gerenciar usuarios e convites' },
      { label: 'Permissoes', href: '/config/permissoes', icon: Shield, desc: 'Roles e permissoes de acesso' },
    ],
  },
  {
    title: 'Operacional',
    items: [
      { label: 'Status de OS', href: '/config/status', icon: Tag, desc: 'Configurar fluxo de status das OS' },
      { label: 'Tipos de Servico', href: '/config/tipos-servico', icon: Wrench, desc: 'Categorias e tipos de servico' },
      { label: 'Templates', href: '/config/templates', icon: PrinterIcon, desc: 'Templates de impressao e email de OS' },
      { label: 'Marcas e Modelos', href: '/config/marcas-modelos', icon: Wrench, desc: 'Marcas e modelos de equipamentos para OS' },
    ],
  },
  {
    title: 'Integracoes',
    items: [
      { label: 'Taxas de Cartao', href: '/config/taxas-cartao', icon: Landmark, desc: 'Taxas por operadora, faixa de parcelas' },
      { label: 'Integracoes Bancarias', href: '/config/integracoes', icon: Landmark, desc: 'Boletos: Inter, Itau, Stone' },
      { label: 'NFS-e / Fiscal', href: '/fiscal/config', icon: FileText, desc: 'Focus NFe, inscricao municipal, aliquota' },
      { label: 'Certificado A1', href: '/config/certificado', icon: FileKey, desc: 'Instalar certificado digital para NF-e/NFS-e' },
      { label: 'Chatwoot / WhatsApp', href: '/integracoes/chatwoot', icon: MessageSquare, desc: 'Conversas e mensagens via WhatsApp' },
    ],
  },
  {
    title: 'Sistema',
    items: [
      { label: 'Avisos', href: '/config/avisos', icon: Bell, desc: 'Leitura obrigatoria, prioridade minima, polling' },
      { label: 'Notificacoes', href: '/config/notificacoes', icon: Bell, desc: 'Email, WhatsApp, alertas internos' },
      { label: 'Backup', href: '/config/backup', icon: Database, desc: 'Exportar dados e backups' },
      { label: 'Aparencia', href: '/config/aparencia', icon: Palette, desc: 'Tema, cores, logo no PDF' },
    ],
  },
]

export default function ConfigPage() {
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Configuracoes</h1>

      {sections.map(section => (
        <div key={section.title}>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-400">
            {section.title}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {section.items.map(item => {
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-start gap-3 rounded-lg border bg-white p-4 shadow-sm transition-colors hover:border-blue-200 hover:bg-blue-50/50"
                >
                  <div className="rounded-lg bg-blue-50 p-2 text-blue-600">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{item.label}</p>
                    <p className="mt-0.5 text-xs text-gray-500">{item.desc}</p>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
