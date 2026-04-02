import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'

// ---------------------------------------------------------------------------
// OFX Parser (same as upload route — shared inline for simplicity)
// ---------------------------------------------------------------------------

interface OFXTransaction {
  trnType: string
  dtPosted: Date
  amount: number
  fitId: string
  memo: string
}

function parseOFX(content: string): OFXTransaction[] {
  const transactions: OFXTransaction[] = []
  const text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const stmtTrnRegex = /<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>|<\/BANKTRANLIST|<\/STMTRS))/gi
  let match: RegExpExecArray | null

  while ((match = stmtTrnRegex.exec(text)) !== null) {
    const block = match[1]
    const trnType = extractTag(block, 'TRNTYPE') || 'OTHER'
    const dtPostedRaw = extractTag(block, 'DTPOSTED') || ''
    const amountRaw = extractTag(block, 'TRNAMT') || '0'
    const fitId = extractTag(block, 'FITID') || ''
    const memo = extractTag(block, 'MEMO') || extractTag(block, 'NAME') || extractTag(block, 'CHECKNUM') || ''

    const dtPosted = parseOFXDate(dtPostedRaw)
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

function extractTag(block: string, tag: string): string | null {
  const inlineRegex = new RegExp(`<${tag}>([^<\\n]+)`, 'i')
  const inlineMatch = inlineRegex.exec(block)
  if (inlineMatch) return inlineMatch[1].trim()

  const nextLineRegex = new RegExp(`<${tag}>\\s*\\n([^<\\n]+)`, 'i')
  const nextLineMatch = nextLineRegex.exec(block)
  if (nextLineMatch) return nextLineMatch[1].trim()

  return null
}

function parseOFXDate(raw: string): Date {
  if (!raw || raw.length < 8) return new Date()
  const clean = raw.replace(/\[.*\]/, '').trim()
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
// POST /api/financeiro/conciliacao/preview
// Parse OFX and return preview without saving to DB
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const result = await requirePermission('financeiro', 'view')
    if (result instanceof NextResponse) return result
    const user = result

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const accountId = formData.get('account_id') as string | null

    if (!file) return error('Arquivo OFX e obrigatorio', 400)
    if (!accountId) return error('Conta bancaria e obrigatoria', 400)

    const fileName = file.name.toLowerCase()
    if (!fileName.endsWith('.ofx') && !fileName.endsWith('.ofc')) {
      return error('Formato invalido. Envie um arquivo .ofx', 400)
    }

    // Validate account
    const account = await prisma.account.findFirst({
      where: { id: accountId, company_id: user.companyId },
    })
    if (!account) return error('Conta bancaria nao encontrada', 404)

    // Parse OFX
    const buffer = await file.arrayBuffer()
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

    // Check for duplicates
    const fitIds = ofxTransactions.map(t => t.fitId)
    const existing = await prisma.transaction.findMany({
      where: {
        company_id: user.companyId,
        account_id: accountId,
        bank_ref: { in: fitIds },
      },
      select: { bank_ref: true },
    })
    const existingSet = new Set(existing.map(t => t.bank_ref))

    const preview = ofxTransactions.map(t => ({
      fitId: t.fitId,
      type: t.amount >= 0 ? 'CREDIT' : 'DEBIT',
      amount: Math.abs(t.amount),
      date: t.dtPosted.toISOString(),
      memo: t.memo || t.trnType,
      is_duplicate: existingSet.has(t.fitId),
    }))

    const newCount = preview.filter(p => !p.is_duplicate).length
    const duplicateCount = preview.filter(p => p.is_duplicate).length
    const totalCredits = preview.filter(p => p.type === 'CREDIT' && !p.is_duplicate).reduce((s, p) => s + p.amount, 0)
    const totalDebits = preview.filter(p => p.type === 'DEBIT' && !p.is_duplicate).reduce((s, p) => s + p.amount, 0)

    return success({
      file_name: file.name,
      transactions: preview,
      summary: {
        total: ofxTransactions.length,
        new: newCount,
        duplicates: duplicateCount,
        total_credits: totalCredits,
        total_debits: totalDebits,
      },
    })
  } catch (err) {
    return handleError(err)
  }
}
