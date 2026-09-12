/**
 * BR Code PIX estático (padrão EMV/BCB) — QR de pagamento nos impressos de
 * entrega (13/09/2026). Gera o payload "PIX copia e cola" com a chave da
 * própria empresa: cliente escaneia no app do banco e paga na entrega, sem
 * intermediário e sem taxa de gateway.
 *
 * Formato: TLV (id 2 dígitos + tamanho 2 dígitos + valor). Campos:
 *   00 payload format "01" · 26 Merchant Account (00 GUI BR.GOV.BCB.PIX + 01 chave)
 *   52 MCC "0000" · 53 moeda "986" · 54 valor (opcional) · 58 "BR"
 *   59 nome (≤25, sem acento) · 60 cidade (≤15) · 62.05 txid (≤25, default "***")
 *   63 CRC16-CCITT-FALSE (calculado sobre tudo incluindo o "6304")
 *
 * Chave tipo CNPJ/CPF/telefone deve ir SEM máscara (canônica) — apps de banco
 * rejeitam chave formatada.
 */

export function crc16ccitt(s: string): string {
  let crc = 0xffff
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

const tlv = (id: string, value: string) => `${id}${String(value.length).padStart(2, '0')}${value}`

// Remove acentos E qualquer nao-ASCII (travessao, emoji): a spec BCB conta o
// tamanho TLV em BYTES — um "—" (3 bytes UTF-8) desloca o parse em apps de
// banco estritos e invalida o QR. So ASCII imprimivel passa.
const semAcento = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ')

/** Chave CNPJ/CPF/telefone formatada → canônica (só dígitos). Email/EVP passam direto. */
function canonicalKey(key: string): string {
  const k = key.trim()
  if (k.includes('@') || /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(k)) return k
  const digits = k.replace(/\D/g, '')
  // CPF 11 / CNPJ 14 / telefone (+55...) — se sobrou algo razoável, usa os dígitos
  return digits.length >= 10 ? (k.startsWith('+') ? '+' + digits : digits) : k
}

export function buildPixBrCode(opts: {
  key: string
  merchantName: string
  merchantCity: string
  amountCents?: number
  txid?: string
}): string {
  const nome = semAcento(opts.merchantName).toUpperCase().slice(0, 25).trim()
  const cidade = semAcento(opts.merchantCity).toUpperCase().slice(0, 15).trim()
  const txid = (opts.txid ? opts.txid.replace(/[^A-Za-z0-9]/g, '').slice(0, 25) : '') || '***'

  let p = tlv('00', '01')
  p += tlv('26', tlv('00', 'BR.GOV.BCB.PIX') + tlv('01', canonicalKey(opts.key)))
  p += tlv('52', '0000')
  p += tlv('53', '986')
  if (opts.amountCents && opts.amountCents > 0) p += tlv('54', (opts.amountCents / 100).toFixed(2))
  p += tlv('58', 'BR')
  p += tlv('59', nome)
  p += tlv('60', cidade)
  p += tlv('62', tlv('05', txid))
  p += '6304'
  return p + crc16ccitt(p)
}
