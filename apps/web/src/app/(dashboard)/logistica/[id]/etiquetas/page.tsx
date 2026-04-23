'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useSearchParams } from 'next/navigation'

/**
 * Pagina de impressao de etiquetas das coletas de uma rota.
 *
 * Query params:
 *   formato=a4 | pimaco | termica
 *   tamanho=a4-6 | 6081 | 6082 | 50x30 | 70x30 | 40x60
 *
 * Cada etiqueta mostra apenas:
 *   - OS #NNNNN  (ENORME, 70% do espaco, bold)
 *   - Nome do cliente (pequeno)
 *
 * A page busca apenas paradas COLETA da rota (nao entregas).
 *
 * Ao carregar, chama window.print() automaticamente — usuario escolhe
 * impressora (laser, Pimaco, Zebra) na caixa de impressao do browser.
 */

type Stop = {
  id: string
  type: 'COLETA' | 'ENTREGA' | 'AVULSA'
  sequence: number
  customer_name: string | null
  os_number: number | null
}

type RouteData = {
  id: string
  stops: Stop[]
}

const FORMATO_DEFAULT = 'a4'
const TAMANHO_DEFAULT = 'a4-6'

// Configs por formato+tamanho — define CSS @page e layout
type Layout = {
  pageSize: string         // '210mm 297mm' | '50mm 30mm'
  cols: number             // colunas no grid
  rows: number             // linhas no grid
  labelW: string           // largura de cada etiqueta
  labelH: string           // altura
  gap: string              // gap entre etiquetas
  margin: string           // margem da pagina
  osFontSize: string       // tamanho da fonte do OS#
  nameFontSize: string     // tamanho da fonte do nome
  dashed: boolean          // mostrar linha tracejada pra cortar (A4 comum)
}

const LAYOUTS: Record<string, Layout> = {
  // A4 comum pra recortar com tesoura — 4 etiquetas grandes (2x2)
  // Espaço folgado pra cortar sem estragar o conteudo, e OS# gigante.
  'a4-6': {
    pageSize: 'A4', cols: 2, rows: 2, labelW: '92mm', labelH: '135mm',
    gap: '4mm', margin: '8mm',
    osFontSize: '96pt', nameFontSize: '22pt', dashed: true,
  },
  // Pimaco 6081 — 14 etiquetas 99x38mm (2x7)
  '6081': {
    pageSize: 'A4', cols: 2, rows: 7, labelW: '99mm', labelH: '38mm',
    gap: '0mm', margin: '10mm 5mm',
    osFontSize: '36pt', nameFontSize: '11pt', dashed: false,
  },
  // Pimaco 6082 — 24 etiquetas 66.7x33.9mm (3x8)
  '6082': {
    pageSize: 'A4', cols: 3, rows: 8, labelW: '66mm', labelH: '33mm',
    gap: '0mm', margin: '12mm 6mm',
    osFontSize: '26pt', nameFontSize: '9pt', dashed: false,
  },
  // Termica 50x30mm
  '50x30': {
    pageSize: '50mm 30mm', cols: 1, rows: 1, labelW: '50mm', labelH: '30mm',
    gap: '0mm', margin: '0',
    osFontSize: '28pt', nameFontSize: '9pt', dashed: false,
  },
  // Termica 70x30mm
  '70x30': {
    pageSize: '70mm 30mm', cols: 1, rows: 1, labelW: '70mm', labelH: '30mm',
    gap: '0mm', margin: '0',
    osFontSize: '36pt', nameFontSize: '11pt', dashed: false,
  },
  // Termica 40x60mm (vertical)
  '40x60': {
    pageSize: '40mm 60mm', cols: 1, rows: 1, labelW: '40mm', labelH: '60mm',
    gap: '0mm', margin: '0',
    osFontSize: '28pt', nameFontSize: '10pt', dashed: false,
  },
}

export default function EtiquetasPage() {
  const params = useParams()
  const search = useSearchParams()
  const routeId = params.id as string
  const tamanho = search.get('tamanho') || TAMANHO_DEFAULT
  const formato = search.get('formato') || FORMATO_DEFAULT
  const layout = LAYOUTS[tamanho] || LAYOUTS[TAMANHO_DEFAULT]

  const [route, setRoute] = useState<RouteData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/logistics/routes/${routeId}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setRoute(data.data)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [routeId])

  useEffect(() => { load() }, [load])

  // Auto-print quando terminar de carregar. Delay pequeno pra garantir
  // que o DOM ja renderizou com as etiquetas.
  useEffect(() => {
    if (!loading && route && (route.stops || []).length > 0) {
      const t = setTimeout(() => window.print(), 600)
      return () => clearTimeout(t)
    }
  }, [loading, route])

  if (loading) return <div style={{ padding: 20 }}>Carregando...</div>
  if (error) return <div style={{ padding: 20 }}>Erro ao carregar rota</div>
  if (!route) return null

  // Filtra so COLETAs pendentes (nao concluidas)
  const coletas = (route.stops || [])
    .filter(s => s.type === 'COLETA')
    .sort((a, b) => a.sequence - b.sequence)

  if (coletas.length === 0) {
    return (
      <div style={{ padding: 20 }}>
        <p>Nenhuma coleta pendente nesta rota.</p>
        <button type="button" onClick={() => window.close()}>Fechar</button>
      </div>
    )
  }

  const isTermica = formato === 'termica'

  return (
    <>
      <style>{`
        @page { size: ${layout.pageSize}; margin: ${layout.margin}; }
        @media print {
          body { margin: 0; padding: 0; background: white; }
          .no-print { display: none !important; }
          .pagebreak-after { page-break-after: always; }
          .label { break-inside: avoid; }
        }
        html, body { margin: 0; padding: 0; background: #f3f4f6; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; }
        .sheet {
          background: white;
          display: grid;
          grid-template-columns: repeat(${layout.cols}, ${layout.labelW});
          grid-template-rows: repeat(${layout.rows}, ${layout.labelH});
          gap: ${layout.gap};
          margin: 10mm auto;
          width: ${isTermica ? layout.labelW : 'auto'};
        }
        .label {
          width: ${layout.labelW};
          height: ${layout.labelH};
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          padding: ${layout.dashed ? '6mm' : '2mm'};
          box-sizing: border-box;
          ${layout.dashed ? 'border: 2px dashed #6b7280; border-radius: 3mm; position: relative;' : ''}
          overflow: hidden;
          background: white;
        }
        ${layout.dashed ? `
        .label::before {
          content: "\\2702";
          position: absolute;
          top: -3mm; left: 3mm;
          background: white;
          padding: 0 2mm;
          font-size: 11pt;
          color: #6b7280;
          line-height: 1;
        }
        .label::after {
          content: "RECORTE E COLE";
          position: absolute;
          bottom: 2mm; left: 50%;
          transform: translateX(-50%);
          font-size: 7pt;
          font-weight: 600;
          color: #9ca3af;
          letter-spacing: 0.2em;
        }
        ` : ''}
        .os-num {
          font-size: ${layout.osFontSize};
          font-weight: 900;
          line-height: 0.9;
          letter-spacing: -0.04em;
          color: #000;
          margin: 0;
          text-align: center;
        }
        .name {
          font-size: ${layout.nameFontSize};
          font-weight: 600;
          color: #1f2937;
          margin-top: ${layout.dashed ? '6mm' : '0.4em'};
          text-align: center;
          max-width: 100%;
          word-break: break-word;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          line-height: 1.2;
        }
        .controls {
          padding: 16px;
          text-align: center;
          background: #fff;
          border-bottom: 1px solid #e5e7eb;
          position: sticky; top: 0; z-index: 10;
        }
        .controls button {
          background: #4f46e5; color: white; border: none;
          padding: 10px 20px; border-radius: 8px; font-size: 14px;
          font-weight: 600; cursor: pointer; margin: 0 4px;
        }
        .controls button.secondary { background: #6b7280; }
      `}</style>

      <div className="controls no-print">
        <span style={{ marginRight: 16, fontSize: 14, color: '#374151' }}>
          {coletas.length} etiqueta{coletas.length > 1 ? 's' : ''} • Formato: <b>{tamanho}</b>
        </span>
        <button type="button" onClick={() => window.print()}>Imprimir</button>
        <button type="button" className="secondary" onClick={() => window.close()}>Fechar</button>
      </div>

      {/* Renderiza em folhas — cada folha tem cols*rows etiquetas */}
      {(() => {
        const perSheet = layout.cols * layout.rows
        const sheets: Stop[][] = []
        for (let i = 0; i < coletas.length; i += perSheet) {
          sheets.push(coletas.slice(i, i + perSheet))
        }
        return sheets.map((sheet, sheetIdx) => (
          <div key={sheetIdx} className={`sheet ${sheetIdx < sheets.length - 1 ? 'pagebreak-after' : ''}`}>
            {sheet.map(stop => (
              <div key={stop.id} className="label">
                <div className="os-num">
                  #{stop.os_number ?? '—'}
                </div>
                <div className="name">
                  {(stop.customer_name || 'Cliente').substring(0, 40)}
                </div>
              </div>
            ))}
            {/* Placeholders vazios pra completar o grid, necessario em Pimaco pra manter alinhamento */}
            {Array.from({ length: perSheet - sheet.length }).map((_, i) => (
              <div key={'empty-' + i} className="label" style={{ border: 'none', background: 'transparent' }} />
            ))}
          </div>
        ))
      })()}
    </>
  )
}
