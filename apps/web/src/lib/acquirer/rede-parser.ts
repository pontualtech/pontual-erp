/**
 * Parser do extrato CSV "Relatorio de Vendas" da Rede (Itau).
 *
 * Formato:
 *  - Separador: `;`
 *  - Encoding: UTF-8 (com acentos preservados)
 *  - 42 colunas (capturadas via portal Rede em 2026-04-28)
 *  - Decimal: virgula (`863,83`)
 *  - Data: DD/MM/AAAA
 *  - Valores como string com mil separator brasileiro (`1.817,98`)
 *
 * Headers chave (subset usado):
 *   data da venda, hora da venda, status da venda,
 *   valor da venda original, modalidade, número de parcelas, bandeira,
 *   taxa MDR, valor MDR,
 *   taxa de recebimento automático, valor taxa de recebimento automático,
 *   valor total das taxas descontadas, valor líquido,
 *   NSU/CV, Prazo de recebimento, número da autorização,
 *   número do cartão, código da maquininha, ID Transação
 */

import type { AcquirerStatementParser, ParsedAcquirerTransaction } from './types'

function parseDateBR(s: string): Date | null {
  // 'DD/MM/YYYY' → Date com timezone BRT explícito (UTC-03:00)
  // M2 fix (audit): antes era 'T00:00:00' sem TZ → servidor Coolify (UTC)
  // interpretava como UTC. Mas CSV vem em horário Brasil. Em transações
  // próximas da meia-noite, dayDiff no match-engine ficava errado (1 em vez
  // de 0) e auto-link não atingia threshold 95 → caía pra suggestion manual.
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim())
  if (!m) return null
  const [, dd, mm, yyyy] = m
  return new Date(`${yyyy}-${mm}-${dd}T00:00:00-03:00`)
}

/**
 * Converte float decimal (BRL) em centavos (Int) com correção de floating point.
 * B4 fix (audit): Math.round(n * 100) sofre floating point edge cases —
 * `1.005 * 100 = 100.4999...` → round retorna 100 em vez de 101.
 * Number.EPSILON elimina o erro pra valores monetários típicos.
 * Exporta pra uso consistente em rede-api-client + outros parsers.
 */
export function toCents(n: number): number {
  if (!isFinite(n) || isNaN(n)) return 0
  return Math.round((n + Number.EPSILON * Math.sign(n || 1)) * 100)
}

function parseAmountBR(s: string): number {
  // '1.817,98' → 181798 (centavos). Vazio/'-' → 0.
  if (!s || s === '-' || s.trim() === '') return 0
  const cleaned = s.replace(/\s/g, '').replace(/\./g, '').replace(',', '.')
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : toCents(n)
}

function parsePercentBR(s: string): number {
  // '2,33%' → 2.33
  if (!s || s === '-' || s.trim() === '') return 0
  const cleaned = s.replace(/%/g, '').replace(/\s/g, '').replace(',', '.')
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : n
}

function parseStatus(s: string): 'APPROVED' | 'CANCELLED' | 'CHARGEBACK' | 'EXPIRED' {
  const t = s.toLowerCase().trim()
  if (t.includes('aprovad')) return 'APPROVED'
  if (t.includes('cancel')) return 'CANCELLED'
  if (t.includes('charg')) return 'CHARGEBACK'
  if (t.includes('expirad') || t.includes('negad')) return 'EXPIRED'
  return 'APPROVED'
}

function parseModality(s: string): 'credit' | 'debit' | undefined {
  const t = s.toLowerCase().trim()
  if (t.includes('crédit') || t.includes('credito')) return 'credit'
  if (t.includes('débit') || t.includes('debito')) return 'debit'
  return undefined
}

function parseBrand(s: string): string | undefined {
  if (!s) return undefined
  return s.toLowerCase().trim().replace(/\s+/g, '_') || undefined
}

function extractCardLast4(masked: string): string | undefined {
  if (!masked) return undefined
  const m = /(\d{4})\s*$/.exec(masked.trim())
  return m ? m[1] : undefined
}

/**
 * Splitter de CSV-com-aspas. Rede usa `;` como sep e nao costuma escapar
 * aspas — mas implementamos defensivo caso algum campo tenha `;` literal
 * dentro de aspas duplas.
 */
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++ } else { inQuotes = !inQuotes }
    } else if (ch === ';' && !inQuotes) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

const REQUIRED_HEADERS = [
  'data da venda',
  'valor da venda original',
  'NSU/CV',
  'taxa MDR',
  'valor líquido',
]

export const redeParser: AcquirerStatementParser = {
  acquirer: 'rede',

  matches(text: string): boolean {
    const head = text.slice(0, 2000).toLowerCase()
    // Heuristica: header contem campos especificos da Rede
    return /data da venda;.*nsu\/cv/i.test(head) ||
           (head.includes('taxa mdr') && head.includes('recebimento autom'))
  },

  parse(text: string) {
    const transactions: ParsedAcquirerTransaction[] = []
    const errors: Array<{ row: number; error: string }> = []

    // Normaliza CRLF e BOM
    const cleaned = text.replace(/^﻿/, '').replace(/\r\n/g, '\n')
    const lines = cleaned.split('\n').filter(l => l.trim().length > 0)
    if (lines.length === 0) return { transactions, errors: [{ row: 0, error: 'arquivo vazio' }] }

    const header = splitCsvLine(lines[0]).map(h => h.trim().toLowerCase())
    const idx = (name: string) => header.indexOf(name.toLowerCase())

    // Validacao de headers obrigatorios
    for (const req of REQUIRED_HEADERS) {
      if (idx(req) === -1) {
        return {
          transactions,
          errors: [{ row: 0, error: `header obrigatorio ausente: '${req}' (encontrados: ${header.slice(0, 5).join(', ')}...)` }],
        }
      }
    }

    const I = {
      dataVenda: idx('data da venda'),
      horaVenda: idx('hora da venda'),
      status: idx('status da venda'),
      valorOriginal: idx('valor da venda original'),
      modalidade: idx('modalidade'),
      parcelas: idx('número de parcelas'),
      bandeira: idx('bandeira'),
      taxaMdr: idx('taxa mdr'),
      valorMdr: idx('valor mdr'),
      taxaRA: idx('taxa de recebimento automático'),
      valorRA: idx('valor taxa de recebimento automático'),
      valorTotalTaxas: idx('valor total das taxas descontadas (mdr+recebimento automático)'),
      valorLiquido: idx('valor líquido'),
      nsu: idx('nsu/cv'),
      prazo: idx('prazo de recebimento'),
      autorizacao: idx('número da autorização (auto)'),
      numeroCartao: idx('número do cartão'),
      meioPag: idx('meio de pagamento'),
      maquininhaCodigo: idx('código da maquininha'),
      tid: idx('tid'),
    }

    for (let i = 1; i < lines.length; i++) {
      try {
        const cols = splitCsvLine(lines[i])
        const modality = parseModality(cols[I.modalidade] || '')
        // Pula PIX (Asaas cuida) e linhas sem modalidade definida (cabecalhos repetidos)
        const meioPag = (cols[I.meioPag] || '').toLowerCase()
        if (!modality || meioPag === 'pix' || (cols[I.modalidade] || '').toLowerCase().includes('pix')) {
          continue
        }

        const status = parseStatus(cols[I.status] || '')
        // Pula expirados (PIX nao pago) — sem efeito financeiro
        if (status === 'EXPIRED') continue

        const txnDate = parseDateBR(cols[I.dataVenda] || '')
        if (!txnDate) {
          errors.push({ row: i + 1, error: `data invalida: '${cols[I.dataVenda]}'` })
          continue
        }

        const externalId = (cols[I.nsu] || '').trim()
        if (!externalId) {
          errors.push({ row: i + 1, error: 'NSU/CV ausente' })
          continue
        }

        // Calcula expected_credit_date a partir do prazo de recebimento
        let expectedCreditDate: Date | undefined
        const prazo = (cols[I.prazo] || '').toLowerCase()
        if (prazo.includes('mesmo dia')) {
          expectedCreditDate = new Date(txnDate)
        } else {
          const m = /(\d+)\s*dias?/i.exec(prazo)
          if (m) {
            const dias = parseInt(m[1])
            const d = new Date(txnDate)
            // Aproxima dias uteis pulando fim de semana
            let added = 0
            while (added < dias) {
              d.setDate(d.getDate() + 1)
              const dow = d.getDay()
              if (dow !== 0 && dow !== 6) added++
            }
            expectedCreditDate = d
          }
        }

        const cardMasked = cols[I.numeroCartao]
        const grossAmount = parseAmountBR(cols[I.valorOriginal])
        const netAmount = parseAmountBR(cols[I.valorLiquido])
        const mdrAmount = parseAmountBR(cols[I.valorMdr])
        const raAmount = parseAmountBR(cols[I.valorRA])
        const totalFee = parseAmountBR(cols[I.valorTotalTaxas]) || (mdrAmount + raAmount)

        transactions.push({
          acquirer: 'rede',
          externalId,
          authorizationCode: cols[I.autorizacao] || undefined,
          cardBrand: parseBrand(cols[I.bandeira]),
          cardLast4: extractCardLast4(cardMasked || ''),
          cardMasked: cardMasked || undefined,
          modality,
          installments: parseInt(cols[I.parcelas] || '1') || 1,
          grossAmount,
          netAmount,
          mdrFeeAmount: mdrAmount,
          mdrFeePercent: parsePercentBR(cols[I.taxaMdr]),
          anticipationFeeAmount: raAmount,
          anticipationFeePercent: parsePercentBR(cols[I.taxaRA]),
          totalFeeAmount: totalFee,
          transactionDate: txnDate,
          transactionTime: cols[I.horaVenda] || undefined,
          expectedCreditDate,
          terminalCode: cols[I.maquininhaCodigo] || undefined,
          status,
          rawData: Object.fromEntries(header.map((h, j) => [h, cols[j] || ''])),
        })
      } catch (err) {
        errors.push({ row: i + 1, error: err instanceof Error ? err.message : 'erro de parsing' })
      }
    }

    return { transactions, errors }
  },
}
