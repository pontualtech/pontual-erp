import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

/**
 * Shared data export utilities for OS, Clients, Products lists.
 * Supports: Excel (.xlsx), CSV, PDF
 */

interface ExportColumn {
  key: string
  label: string
  width?: number // PDF column width
  format?: (value: any) => string
}

interface ExportOptions {
  filename: string
  title?: string // PDF title
  columns: ExportColumn[]
  data: Record<string, any>[]
}

/** Format currency from centavos */
function fmtCurrency(cents: number | null | undefined): string {
  if (!cents && cents !== 0) return ''
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

/** Format date */
function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return ''
  return new Date(d).toLocaleDateString('pt-BR')
}

/** Get cell value using column format or raw value */
function getCellValue(row: Record<string, any>, col: ExportColumn): string {
  const raw = row[col.key]
  if (col.format) return col.format(raw)
  if (raw == null) return ''
  return String(raw)
}

// ---------------------------------------------------------------------------
// Excel Export (.xlsx)
// ---------------------------------------------------------------------------

export function exportToExcel(opts: ExportOptions) {
  const headers = opts.columns.map(c => c.label)
  const rows = opts.data.map(row => opts.columns.map(col => getCellValue(row, col)))

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])

  // Auto-width columns
  ws['!cols'] = opts.columns.map((col, i) => {
    const maxLen = Math.max(
      col.label.length,
      ...rows.map(r => (r[i] || '').length)
    )
    return { wch: Math.min(Math.max(maxLen + 2, 10), 50) }
  })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Dados')
  XLSX.writeFile(wb, `${opts.filename}.xlsx`)
}

// ---------------------------------------------------------------------------
// CSV Export
// ---------------------------------------------------------------------------

export function exportToCSV(opts: ExportOptions) {
  const sep = ';'
  const headers = opts.columns.map(c => `"${c.label}"`).join(sep)
  const rows = opts.data.map(row =>
    opts.columns.map(col => `"${getCellValue(row, col).replace(/"/g, '""')}"`).join(sep)
  )
  const csv = [headers, ...rows].join('\n')
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${opts.filename}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// PDF Export
// ---------------------------------------------------------------------------

export function exportToPDF(opts: ExportOptions) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  // Title
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text(opts.title || opts.filename, 14, 15)

  // Date
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 14, 22)
  doc.text(`Total: ${opts.data.length} registros`, 14, 27)

  // Table
  autoTable(doc, {
    startY: 32,
    head: [opts.columns.map(c => c.label)],
    body: opts.data.map(row => opts.columns.map(col => getCellValue(row, col))),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 },
  })

  doc.save(`${opts.filename}.pdf`)
}

// ---------------------------------------------------------------------------
// Import from Excel/CSV
// ---------------------------------------------------------------------------

export interface ImportResult {
  headers: string[]
  rows: Record<string, string>[]
  filename: string
}

export function importFromFile(file: File): Promise<ImportResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        const data = e.target?.result
        if (!data) { reject(new Error('Arquivo vazio')); return }

        if (file.name.endsWith('.csv') || file.name.endsWith('.txt')) {
          // CSV parsing
          const text = typeof data === 'string' ? data : new TextDecoder('utf-8').decode(data as ArrayBuffer)
          const lines = text.split(/\r?\n/).filter(l => l.trim())
          if (lines.length < 2) { reject(new Error('Arquivo sem dados')); return }

          const sep = lines[0].includes(';') ? ';' : ','
          const headers = lines[0].split(sep).map(h => h.replace(/^"|"$/g, '').trim())
          const rows = lines.slice(1).map(line => {
            const vals = line.split(sep).map(v => v.replace(/^"|"$/g, '').trim())
            const obj: Record<string, string> = {}
            headers.forEach((h, i) => { obj[h] = vals[i] || '' })
            return obj
          })
          resolve({ headers, rows, filename: file.name })
        } else {
          // Excel parsing
          const wb = XLSX.read(data, { type: 'array' })
          const ws = wb.Sheets[wb.SheetNames[0]]
          const jsonData = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' })
          if (jsonData.length === 0) { reject(new Error('Planilha vazia')); return }
          const headers = Object.keys(jsonData[0])
          resolve({ headers, rows: jsonData.map(r => {
            const obj: Record<string, string> = {}
            headers.forEach(h => { obj[h] = String(r[h] ?? '') })
            return obj
          }), filename: file.name })
        }
      } catch (err) {
        reject(new Error('Erro ao ler arquivo: ' + (err instanceof Error ? err.message : 'desconhecido')))
      }
    }

    reader.onerror = () => reject(new Error('Erro ao ler arquivo'))

    if (file.name.endsWith('.csv') || file.name.endsWith('.txt')) {
      reader.readAsText(file, 'utf-8')
    } else {
      reader.readAsArrayBuffer(file)
    }
  })
}

// Convenience exports
export { fmtCurrency, fmtDate }
