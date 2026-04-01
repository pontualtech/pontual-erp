'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

interface BoletoData {
  id: string
  description: string
  amount: number
  dueDate: string
  status: string
  nossoNumero: string
  barcode: string
  digitableLine: string
  pixCode: string | null
  boletoUrl: string | null
  customerName: string
  customerDocument: string
  // Cedente (from settings)
  cedenteNome: string
  cedenteCnpj: string
  cedenteAgencia: string
  cedenteConta: string
  cedenteCarteira: string
  // Sacado extra
  customerEndereco: string
  customerCidade: string
  customerUf: string
  customerCep: string
  customerEmail: string
  // Instrucoes
  multa: string
  juros: string
  mensagem: string
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('pt-BR')
}

function formatDoc(doc: string) {
  if (!doc) return ''
  const d = doc.replace(/\D/g, '')
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  return doc
}

export default function BoletoPrintPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><p className="text-gray-500">Carregando...</p></div>}>
      <BoletoPrintContent />
    </Suspense>
  )
}

function BoletoPrintContent() {
  const searchParams = useSearchParams()
  const [boletos, setBoletos] = useState<BoletoData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const ids = searchParams.get('ids')
    if (!ids) {
      setError('Nenhum boleto selecionado')
      setLoading(false)
      return
    }

    fetch(`/api/financeiro/boletos/print?ids=${ids}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setBoletos(d.data || [])
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [searchParams])

  useEffect(() => {
    if (boletos.length > 0 && !loading) {
      setTimeout(() => window.print(), 500)
    }
  }, [boletos, loading])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">Carregando boletos...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-red-500">{error}</p>
      </div>
    )
  }

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .boleto-page { page-break-after: always; }
          .boleto-page:last-child { page-break-after: avoid; }
          body { margin: 0; padding: 0; }
          @page { margin: 10mm 15mm; size: A4; }
        }
        .boleto-table td { padding: 4px 8px; font-size: 11px; }
        .boleto-table th { padding: 4px 8px; font-size: 9px; text-transform: uppercase; color: #666; text-align: left; font-weight: 600; }
        .boleto-divider { border-top: 1px dashed #999; margin: 16px 0; position: relative; }
        .boleto-divider::after { content: 'Recibo do Pagador'; position: absolute; top: -8px; left: 50%; transform: translateX(-50%); background: white; padding: 0 12px; font-size: 10px; color: #888; }
        .boleto-border { border: 1px solid #333; }
        .field-label { font-size: 9px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 1px; }
        .field-value { font-size: 12px; color: #111; font-weight: 500; }
        .field-value-mono { font-size: 11px; color: #111; font-family: 'Courier New', monospace; letter-spacing: 1px; }
      `}</style>

      {/* Botao imprimir (nao aparece na impressao) */}
      <div className="no-print fixed top-4 right-4 z-50 flex gap-2">
        <button
          onClick={() => window.print()}
          className="rounded-lg bg-orange-600 px-6 py-2.5 text-sm font-medium text-white shadow-lg hover:bg-orange-700"
        >
          Imprimir
        </button>
        <button
          onClick={() => window.close()}
          className="rounded-lg border bg-white px-4 py-2.5 text-sm text-gray-600 shadow-lg hover:bg-gray-50"
        >
          Fechar
        </button>
      </div>

      {boletos.map((b, idx) => (
        <div key={b.id} className="boleto-page" style={{ fontFamily: 'Arial, sans-serif', maxWidth: '210mm', margin: '0 auto', padding: '20px' }}>

          {/* ============ FICHA DE COMPENSACAO ============ */}
          <div className="boleto-border" style={{ padding: '0' }}>

            {/* Header banco */}
            <div style={{ display: 'flex', borderBottom: '2px solid #333', alignItems: 'stretch' }}>
              <div style={{ padding: '8px 12px', borderRight: '2px solid #333', display: 'flex', alignItems: 'center', gap: '8px', minWidth: '200px' }}>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#f97316' }}>inter</div>
              </div>
              <div style={{ padding: '8px 16px', borderRight: '2px solid #333', display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: '80px' }}>
                <span style={{ fontSize: '18px', fontWeight: 'bold' }}>077-1</span>
              </div>
              <div style={{ padding: '8px 12px', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                <span className="field-value-mono" style={{ fontSize: '13px', letterSpacing: '2px' }}>
                  {b.digitableLine || 'Aguardando registro bancario'}
                </span>
              </div>
            </div>

            {/* Linha 1: Cedente */}
            <div style={{ display: 'flex', borderBottom: '1px solid #ccc' }}>
              <div style={{ flex: 3, padding: '4px 8px', borderRight: '1px solid #ccc' }}>
                <div className="field-label">Beneficiario</div>
                <div className="field-value">{b.cedenteNome}</div>
              </div>
              <div style={{ flex: 1, padding: '4px 8px', borderRight: '1px solid #ccc' }}>
                <div className="field-label">CNPJ</div>
                <div className="field-value">{formatDoc(b.cedenteCnpj)}</div>
              </div>
              <div style={{ flex: 1, padding: '4px 8px', borderRight: '1px solid #ccc' }}>
                <div className="field-label">Agencia / Conta</div>
                <div className="field-value">{b.cedenteAgencia} / {b.cedenteConta}</div>
              </div>
              <div style={{ flex: 1, padding: '4px 8px' }}>
                <div className="field-label">Nosso Numero</div>
                <div className="field-value-mono">{b.nossoNumero || 'A definir'}</div>
              </div>
            </div>

            {/* Linha 2: Datas e valores */}
            <div style={{ display: 'flex', borderBottom: '1px solid #ccc' }}>
              <div style={{ flex: 1, padding: '4px 8px', borderRight: '1px solid #ccc' }}>
                <div className="field-label">Data do Documento</div>
                <div className="field-value">{formatDate(new Date().toISOString())}</div>
              </div>
              <div style={{ flex: 1, padding: '4px 8px', borderRight: '1px solid #ccc' }}>
                <div className="field-label">Numero do Documento</div>
                <div className="field-value">{b.id.substring(0, 15)}</div>
              </div>
              <div style={{ flex: 1, padding: '4px 8px', borderRight: '1px solid #ccc' }}>
                <div className="field-label">Especie</div>
                <div className="field-value">R$</div>
              </div>
              <div style={{ flex: 1, padding: '4px 8px', borderRight: '1px solid #ccc' }}>
                <div className="field-label">Carteira</div>
                <div className="field-value">{b.cedenteCarteira}</div>
              </div>
              <div style={{ flex: 1, padding: '4px 8px' }}>
                <div className="field-label">Vencimento</div>
                <div className="field-value" style={{ fontSize: '14px', fontWeight: 'bold' }}>{formatDate(b.dueDate)}</div>
              </div>
            </div>

            {/* Linha 3: Valor */}
            <div style={{ display: 'flex', borderBottom: '1px solid #ccc' }}>
              <div style={{ flex: 3, padding: '4px 8px', borderRight: '1px solid #ccc' }}>
                <div className="field-label">Instrucoes (Texto de responsabilidade do beneficiario)</div>
                <div style={{ fontSize: '11px', color: '#333', lineHeight: '1.6', minHeight: '60px' }}>
                  {b.multa && <div>Multa de {b.multa} apos o vencimento</div>}
                  {b.juros && <div>Juros de {b.juros} ao mes</div>}
                  {b.mensagem && <div>{b.mensagem}</div>}
                  <div>Nao receber apos 30 dias do vencimento</div>
                  {b.pixCode && <div style={{ marginTop: '4px', color: '#7c3aed' }}>PIX Copia e Cola disponivel</div>}
                </div>
              </div>
              <div style={{ flex: 1, padding: '4px 8px' }}>
                <div className="field-label">Valor do Documento</div>
                <div className="field-value" style={{ fontSize: '16px', fontWeight: 'bold', textAlign: 'right' }}>
                  {formatCurrency(b.amount)}
                </div>
              </div>
            </div>

            {/* Linha 4: Descontos / Deducoes */}
            <div style={{ display: 'flex', borderBottom: '1px solid #ccc' }}>
              <div style={{ flex: 3, padding: '4px 8px', borderRight: '1px solid #ccc' }}>
                <div className="field-label">Descricao</div>
                <div className="field-value">{b.description}</div>
              </div>
              <div style={{ flex: 1, padding: '4px 8px' }}>
                <div className="field-label">(-) Desconto / Abatimento</div>
                <div className="field-value" style={{ textAlign: 'right' }}></div>
              </div>
            </div>

            {/* Linha 5: Sacado */}
            <div style={{ padding: '6px 8px', borderBottom: '1px solid #ccc' }}>
              <div className="field-label">Pagador</div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div className="field-value">{b.customerName}</div>
                <div className="field-value">{formatDoc(b.customerDocument)}</div>
              </div>
              {b.customerEndereco && (
                <div style={{ fontSize: '10px', color: '#555', marginTop: '2px' }}>
                  {b.customerEndereco}
                  {b.customerCidade && ` - ${b.customerCidade}`}
                  {b.customerUf && `/${b.customerUf}`}
                  {b.customerCep && ` - CEP: ${b.customerCep}`}
                </div>
              )}
            </div>

            {/* Codigo de barras area */}
            {b.barcode ? (
              <div style={{ padding: '12px 8px', textAlign: 'center' }}>
                <div style={{ fontFamily: 'monospace', fontSize: '28px', letterSpacing: '4px', lineHeight: '1' }}>
                  {'||| || ||| || | || ||| | |||| || ||| ||'}
                </div>
                <div style={{ fontSize: '9px', color: '#888', marginTop: '4px' }}>
                  Representacao do codigo de barras — utilize a linha digitavel acima para pagamento
                </div>
              </div>
            ) : (
              <div style={{ padding: '12px 8px', textAlign: 'center', background: '#fffbeb' }}>
                <div style={{ fontSize: '11px', color: '#92400e', fontWeight: '500' }}>
                  Boleto em processamento pelo banco — codigo de barras sera disponibilizado apos registro
                </div>
              </div>
            )}
          </div>

          {/* PIX Section */}
          {b.pixCode && (
            <div style={{ marginTop: '12px', border: '1px solid #7c3aed', borderRadius: '8px', padding: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#7c3aed' }}>PIX Copia e Cola</span>
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: '9px', wordBreak: 'break-all', color: '#333', background: '#f5f3ff', padding: '8px', borderRadius: '4px' }}>
                {b.pixCode}
              </div>
            </div>
          )}

          {/* ============ RECIBO DO PAGADOR ============ */}
          <div className="boleto-divider"></div>

          <div className="boleto-border" style={{ padding: '0' }}>
            {/* Header recibo */}
            <div style={{ display: 'flex', borderBottom: '1px solid #ccc', alignItems: 'stretch' }}>
              <div style={{ padding: '6px 12px', borderRight: '1px solid #ccc', display: 'flex', alignItems: 'center', gap: '8px', minWidth: '200px' }}>
                <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#f97316' }}>inter</span>
                <span style={{ fontSize: '12px', fontWeight: 'bold' }}>077-1</span>
              </div>
              <div style={{ flex: 1, padding: '6px 12px' }}>
                <div className="field-label">Recibo do Pagador</div>
              </div>
            </div>

            <div style={{ display: 'flex', borderBottom: '1px solid #ccc' }}>
              <div style={{ flex: 2, padding: '4px 8px', borderRight: '1px solid #ccc' }}>
                <div className="field-label">Beneficiario</div>
                <div style={{ fontSize: '11px' }}>{b.cedenteNome} — CNPJ: {formatDoc(b.cedenteCnpj)}</div>
              </div>
              <div style={{ flex: 1, padding: '4px 8px', borderRight: '1px solid #ccc' }}>
                <div className="field-label">Ag./Conta</div>
                <div style={{ fontSize: '11px' }}>{b.cedenteAgencia} / {b.cedenteConta}</div>
              </div>
              <div style={{ flex: 1, padding: '4px 8px' }}>
                <div className="field-label">Nosso Numero</div>
                <div className="field-value-mono" style={{ fontSize: '10px' }}>{b.nossoNumero || 'A definir'}</div>
              </div>
            </div>

            <div style={{ display: 'flex', borderBottom: '1px solid #ccc' }}>
              <div style={{ flex: 2, padding: '4px 8px', borderRight: '1px solid #ccc' }}>
                <div className="field-label">Pagador</div>
                <div style={{ fontSize: '11px' }}>{b.customerName} — {formatDoc(b.customerDocument)}</div>
              </div>
              <div style={{ flex: 1, padding: '4px 8px', borderRight: '1px solid #ccc' }}>
                <div className="field-label">Vencimento</div>
                <div className="field-value">{formatDate(b.dueDate)}</div>
              </div>
              <div style={{ flex: 1, padding: '4px 8px' }}>
                <div className="field-label">Valor</div>
                <div className="field-value" style={{ fontWeight: 'bold' }}>{formatCurrency(b.amount)}</div>
              </div>
            </div>

            <div style={{ padding: '4px 8px' }}>
              <div className="field-label">Descricao</div>
              <div style={{ fontSize: '11px' }}>{b.description}</div>
            </div>
          </div>

          {/* Autenticacao mecanica */}
          <div style={{ textAlign: 'right', marginTop: '4px' }}>
            <span style={{ fontSize: '9px', color: '#999' }}>Autenticacao mecanica</span>
          </div>

        </div>
      ))}
    </>
  )
}
