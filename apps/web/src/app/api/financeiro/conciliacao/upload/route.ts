import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'

// ---------------------------------------------------------------------------
// OFX Parser — handles real Brazilian bank OFX files (Itau, Inter, Bradesco,
// Nubank, BB, Sicoob, etc.)
//
// OFX uses SGML (not strict XML). Tags may or may not be self-closed, values
// appear on the same line as the tag or on the next line, and the header is
// not XML at all. We parse it with regex to be resilient.
// ---------------------------------------------------------------------------

interface OFXTransaction {
  trnType: string
  dtPosted: Date
  amount: number   // in centavos (integer)
  fitId: string
  memo: string
}

/**
 * Parse an OFX file content string into an array of transactions.
 * Handles the common quirks of Brazilian bank OFX exports:
 * - SGML-style tags (no closing tags, no quotes)
 * - Mixed encodings (Latin-1, UTF-8, Windows-1252)
 * - Dates in YYYYMMDDHHMMSS or YYYYMMDD format
 * - Amounts with period as decimal separator
 */
function parseOFX(content: string): OFXTransaction[] {
  const transactions: OFXTransaction[] = []

  // Normalize line endings
  const text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  // Extract all STMTTRN blocks
  const stmtTrnRegex = /<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>|<\/BANKTRANLIST|<\/STMTRS))/gi
  let match: RegExpExecArray | null

  while ((match = stmtTrnRegex.exec(text)) !== null) {
    const block = match[1]

    const trnType = extractTag(block, 'TRNTYPE') || 'OTHER'
    const dtPostedRaw = extractTag(block, 'DTPOSTED') || ''
    const amountRaw = extractTag(block, 'TRNAMT') || '0'
    const fitId = extractTag(block, 'FITID') || ''
    const memo = extractTag(block, 'MEMO') || extractTag(block, 'NAME') || extractTag(block, 'CHECKNUM') || ''

    // Parse date: YYYYMMDDHHMMSS[.XXX] or YYYYMMDD
    const dtPosted = parseOFXDate(dtPostedRaw)

    // Parse amount: OFX uses period decimal, negative = debit
    // Convert to centavos (integer)
    const amountFloat = parseFloat(amountRaw.replace(/\s/g, '').replace(',', '.'))
    const amount = Math.round(amountFloat * 100)

    if (fitId) {
      transactions.push({
        trnType: trnType.trim().toUpperCase(),
        dtPosted,
        amount,
        fitId: fitId.trim(),
        memo: memo.trim(),
      })
    }
  }

  return transactions
}

/**
 * Extract a tag value from an OFX SGML block.
 * Handles both:
 *   <TAG>VALUE           (SGML style, no closing tag)
 *   <TAG>VALUE</TAG>     (XML style)
 *   <TAG>\nVALUE         (value on next line)
 */
function extractTag(block: string, tag: string): string | null {
  // Try inline value first: <TAG>value
  const inlineRegex = new RegExp(`<${tag}>([^<\\n]+)`, 'i')
  const inlineMatch = inlineRegex.exec(block)
  if (inlineMatch) {
    return inlineMatch[1].trim()
  }

  // Try value on next line: <TAG>\nvalue
  const nextLineRegex = new RegExp(`<${tag}>\\s*\\n([^<\\n]+)`, 'i')
  const nextLineMatch = nextLineRegex.exec(block)
  if (nextLineMatch) {
    return nextLineMatch[1].trim()
  }

  return null
}

/**
 * Parse OFX date format: YYYYMMDDHHMMSS[.XXX][:timezone]
 * Brazilian banks often output just YYYYMMDD or YYYYMMDDHHMMSS
 */
function parseOFXDate(raw: string): Date {
  if (!raw || raw.length < 8) return new Date()

  const clean = raw.replace(/\[.*\]/, '').trim() // remove timezone bracket [+3:BRT]
  const year = parseInt(clean.substring(0, 4), 10)
  const month = parseInt(clean.substring(4, 6), 10) - 1
  const day = parseInt(clean.substring(6, 8), 10)

  let hours = 0, minutes = 0, seconds = 0
  if (clean.length >= 14) {
    hours = parseInt(clean.substring(8, 10), 10) || 0
    minutes = parseInt(clean.substring(10, 12), 10) || 0
    seconds = parseInt(clean.substring(12, 14), 10) || 0
  }

  return new Date(year, month, day, hours, minutes, seconds)
}

// ---------------------------------------------------------------------------
// POST /api/financeiro/conciliacao/upload
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'edit')
    if (result instanceof NextResponse) return result
    const user = result

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const accountId = formData.get('account_id') as string | null

    if (!file) return error('Arquivo OFX e obrigatorio', 400)
    if (!accountId) return error('Conta bancaria e obrigatoria', 400)

    // Validate the file is .ofx
    const fileName = file.name.toLowerCase()
    if (!fileName.endsWith('.ofx') && !fileName.endsWith('.ofc')) {
      return error('Formato invalido. Envie um arquivo .ofx', 400)
    }

    // Validate account belongs to company
    const account = await prisma.account.findFirst({
      where: { id: accountId, company_id: user.companyId },
    })
    if (!account) return error('Conta bancaria nao encontrada', 404)

    // Read and parse the OFX file
    const buffer = await file.arrayBuffer()
    // Try UTF-8 first, then Latin-1 fallback
    let content: string
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    } catch {
      content = new TextDecoder('iso-8859-1').decode(buffer)
    }

    const ofxTransactions = parseOFX(content)

    if (ofxTransactions.length === 0) {
      return error('Nenhuma transacao encontrada no arquivo OFX', 400)
    }

    // Check which FITIDs already exist for this account to avoid duplicates
    const existingFitIds = ofxTransactions.map(t => t.fitId)
    const existingTransactions = await prisma.transaction.findMany({
      where: {
        company_id: user.companyId,
        account_id: accountId,
        bank_ref: { in: existingFitIds },
      },
      select: { bank_ref: true },
    })
    const existingSet = new Set(existingTransactions.map(t => t.bank_ref))

    // Filter out duplicates and prepare records
    const newTransactions = ofxTransactions.filter(t => !existingSet.has(t.fitId))
    const skipped = ofxTransactions.length - newTransactions.length

    // Batch create new transactions
    if (newTransactions.length > 0) {
      await prisma.transaction.createMany({
        data: newTransactions.map(t => ({
          company_id: user.companyId,
          account_id: accountId,
          transaction_type: t.amount >= 0 ? 'CREDIT' : 'DEBIT',
          amount: Math.abs(t.amount),
          description: t.memo || `${t.trnType}`,
          bank_ref: t.fitId,
          reconciled: false,
          transaction_date: t.dtPosted,
        })),
      })
    }

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'financeiro',
      action: 'conciliacao.upload',
      entityId: accountId,
      newValue: {
        file_name: file.name,
        total_in_file: ofxTransactions.length,
        imported: newTransactions.length,
        skipped,
      },
    })

    return success({
      total: ofxTransactions.length,
      imported: newTransactions.length,
      skipped,
    })
  } catch (err) {
    return handleError(err)
  }
}
