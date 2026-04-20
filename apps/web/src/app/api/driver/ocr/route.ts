import { NextRequest, NextResponse } from 'next/server'
import { requireDriver } from '@/lib/driver-auth'

/**
 * POST /api/driver/ocr
 * Body: { image_base64: string }
 * Returns: { data: { serial: string | null, raw_text: string } }
 *
 * Strategy:
 *  1. If GOOGLE_VISION_API_KEY is set → call Vision OCR (text detection)
 *  2. Otherwise → return null serial (driver fallback to manual entry)
 *
 * We always return 200 with `serial: null` on any failure so the driver app
 * never sees an OCR error in the middle of a collection flow — just lets
 * them type the number.
 */
export async function POST(req: NextRequest) {
  const auth = await requireDriver()
  if (auth instanceof NextResponse) return auth

  const { image_base64 } = await req.json().catch(() => ({}))
  if (!image_base64 || typeof image_base64 !== 'string') {
    return NextResponse.json({ data: { serial: null, raw_text: '' } })
  }

  const visionKey = process.env.GOOGLE_VISION_API_KEY
  if (!visionKey) {
    // No key — driver types manually. Endpoint exists so the client flow is
    // stable; swap for real OCR by setting the env var.
    console.log('[OCR] GOOGLE_VISION_API_KEY missing, returning empty')
    return NextResponse.json({ data: { serial: null, raw_text: '' } })
  }

  try {
    const visionRes = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${visionKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            image: { content: image_base64 },
            features: [{ type: 'TEXT_DETECTION', maxResults: 1 }],
          }],
        }),
        signal: AbortSignal.timeout(15_000),
      }
    )
    if (!visionRes.ok) throw new Error(`vision ${visionRes.status}`)
    const vision = await visionRes.json()
    const rawText: string = vision?.responses?.[0]?.fullTextAnnotation?.text || ''
    const serial = extractSerial(rawText)
    return NextResponse.json({ data: { serial, raw_text: rawText } })
  } catch (err) {
    console.warn('[OCR] vision call failed:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ data: { serial: null, raw_text: '' } })
  }
}

/**
 * Extracts the most likely serial number from OCR text.
 * Heuristics:
 *  1. Look for a line containing "S/N", "SN", "Serial" and pick the following alnum group.
 *  2. Else pick the longest alnum token of 6-20 chars that has both letters and digits.
 */
function extractSerial(text: string): string | null {
  if (!text) return null
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  for (const line of lines) {
    const m = line.match(/(?:s\/?n|serial|serie)\s*[:#]?\s*([A-Z0-9-]{6,20})/i)
    if (m?.[1]) return m[1].toUpperCase()
  }
  // Pick a token with letters AND digits (discards plain model numbers like "L3150")
  const tokens = (text.match(/[A-Z0-9-]{6,20}/gi) || [])
    .filter(t => /[A-Z]/i.test(t) && /\d/.test(t))
    .sort((a, b) => b.length - a.length)
  return tokens[0]?.toUpperCase() || null
}
