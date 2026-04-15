'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'

interface ReportData {
  company_name: string
  customer_name: string
  customer_type: string
  customer_document: string
  period: { start: string; end: string; week: string }
  summary: {
    total_orders: number
    total_open: number
    total_closed: number
    total_value: number
    total_value_formatted: string
  }
  orders: Array<{
    os_number: number
    equipment: string
    status: string
    value: number
    value_formatted: string
    created_at: string
  }>
}

export default function RelatoriosPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params.slug as string

  const [report, setReport] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [company, setCompany] = useState<{ name: string } | null>(null)

  useEffect(() => {
    const saved = localStorage.getItem('portal_company')
    if (saved) setCompany(JSON.parse(saved))

    fetch('/api/portal/reports/weekly')
      .then(r => {
        if (r.status === 401) { router.push(`/portal/${slug}/login`); return null }
        return r.json()
      })
      .then(res => { if (res?.data) setReport(res.data) })
      .catch(() => toast.error('Erro ao carregar relatorio'))
      .finally(() => setLoading(false))
  }, [slug, router])

  async function handleGeneratePDF() {
    if (!report) return
    setGenerating(true)

    try {
      const { default: jsPDF } = await import('jspdf')
      const { default: autoTable } = await import('jspdf-autotable')

      const doc = new jsPDF()

      // Header
      doc.setFontSize(18)
      doc.setFont('helvetica', 'bold')
      doc.text(report.company_name, 105, 20, { align: 'center' })
      doc.setFontSize(12)
      doc.setFont('helvetica', 'normal')
      doc.text('Relatorio Semanal de Ordens de Servico', 105, 28, { align: 'center' })

      // Period
      doc.setFontSize(10)
      doc.text(`Periodo: ${report.period.start} a ${report.period.end}`, 14, 40)
      doc.text(`Cliente: ${report.customer_name}`, 14, 46)
      doc.text(`Documento: ${report.customer_document || '-'}`, 14, 52)
      doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 14, 58)

      // Summary
      doc.setFillColor(239, 246, 255) // blue-50
      doc.rect(14, 65, 182, 22, 'F')
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.text('Resumo', 18, 73)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.text(`Total de OS: ${report.summary.total_orders}`, 18, 80)
      doc.text(`Em andamento: ${report.summary.total_open}`, 80, 80)
      doc.text(`Concluidas: ${report.summary.total_closed}`, 130, 80)
      doc.text(`Valor total: ${report.summary.total_value_formatted}`, 18, 86)

      // Table
      if (report.orders.length > 0) {
        autoTable(doc, {
          startY: 95,
          head: [['OS #', 'Equipamento', 'Status', 'Valor', 'Data']],
          body: report.orders.map(os => [
            `#${os.os_number}`,
            os.equipment,
            os.status,
            os.value_formatted,
            os.created_at,
          ]),
          styles: { fontSize: 9, cellPadding: 3 },
          headStyles: { fillColor: [30, 64, 175], textColor: 255, fontStyle: 'bold' },
          alternateRowStyles: { fillColor: [249, 250, 251] },
          columnStyles: {
            0: { cellWidth: 20 },
            3: { halign: 'right', cellWidth: 30 },
            4: { cellWidth: 25 },
          },
        })
      } else {
        doc.text('Nenhuma OS encontrada no periodo.', 14, 100)
      }

      // Footer
      const pageHeight = doc.internal.pageSize.height
      doc.setFontSize(8)
      doc.setTextColor(150)
      doc.text(`Gerado automaticamente pelo Portal do Cliente — ${report.company_name} via PontualERP`, 105, pageHeight - 10, { align: 'center' })

      // Download
      doc.save(`relatorio-semanal-${report.period.week}.pdf`)
      toast.success('PDF gerado!')
    } catch (err) {
      console.error('[PDF Generation Error]', err)
      toast.error('Erro ao gerar PDF')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950">
      <header className="bg-white dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-800 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href={`/portal/${slug}`} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="font-semibold text-gray-900 dark:text-gray-100">Relatorios</h1>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-400" />
          </div>
        ) : !report || report.orders.length === 0 ? (
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-12 text-center">
            <svg className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-gray-500 dark:text-gray-400 font-medium">Nenhuma OS nesta semana</p>
            <p className="text-gray-400 dark:text-gray-500 text-sm mt-1">Relatorios aparecem quando houver OS no periodo.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Period header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                  Relatorio Semanal
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  {report.period.start} a {report.period.end}
                </p>
              </div>
              <button
                type="button"
                onClick={handleGeneratePDF}
                disabled={generating}
                className="flex items-center gap-2 bg-blue-600 dark:bg-blue-500 hover:bg-blue-700 dark:hover:bg-blue-600 text-white font-semibold py-2.5 px-5 rounded-xl transition-colors text-sm disabled:opacity-50"
              >
                {generating ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                    Gerando...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Baixar PDF
                  </>
                )}
              </button>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-4 text-center">
                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{report.summary.total_orders}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Total OS</p>
              </div>
              <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-4 text-center">
                <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{report.summary.total_open}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Em Andamento</p>
              </div>
              <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-4 text-center">
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">{report.summary.total_closed}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Concluidas</p>
              </div>
              <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 p-4 text-center">
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{report.summary.total_value_formatted}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Valor Total</p>
              </div>
            </div>

            {/* Orders table */}
            <div className="bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 dark:bg-zinc-800/50 border-b border-gray-100 dark:border-zinc-800">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 capitalize">OS</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 capitalize">Equipamento</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 capitalize">Status</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 capitalize">Valor</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 capitalize">Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
                  {report.orders.map(os => (
                    <tr key={os.os_number} className="hover:bg-gray-50 dark:hover:bg-zinc-800/50">
                      <td className="px-5 py-3 font-semibold text-gray-900 dark:text-gray-100">#{os.os_number}</td>
                      <td className="px-5 py-3 text-sm text-gray-700 dark:text-gray-300">{os.equipment}</td>
                      <td className="px-5 py-3 text-sm text-gray-600 dark:text-gray-400">{os.status}</td>
                      <td className="px-5 py-3 text-sm text-gray-900 dark:text-gray-100 text-right font-medium">{os.value_formatted}</td>
                      <td className="px-5 py-3 text-sm text-gray-500 dark:text-gray-400">{os.created_at}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 mt-12">
        <div className="max-w-4xl mx-auto px-4 py-4 text-center text-xs text-gray-400 dark:text-gray-500">
          Powered by PontualERP
        </div>
      </footer>
    </div>
  )
}
