/**
 * Monta o nfeProc distribuível (NFe ASSINADA + protNFe de autorização) — o
 * documento fiscal que o destinatário escritura e que a lei manda guardar 5 anos.
 *
 * Origem (auditoria 03/09, NF 211): o ERP não persistia o XML autorizado; o
 * endpoint de download fabricava um resumo sem assinatura/protocolo. Este helper
 * é usado na emissão pra salvar o documento completo em invoices.xml_content.
 *
 * Retorna null quando falta peça essencial (sem assinatura ou sem protNFe
 * fechado) — melhor não persistir do que persistir documento sem valor fiscal.
 */
const NFE_NS = 'http://www.portalfiscal.inf.br/nfe'

export function buildNfeProc(signedXml: string, protNfeXml: string): string | null {
  if (!signedXml || !protNfeXml) return null

  // Remove declaração <?xml?> que possa vir junto do XML assinado
  const signed = signedXml.replace(/^\s*<\?xml[^?]*\?>\s*/i, '').trim()
  const prot = protNfeXml.trim()

  // Peças essenciais: NFe com Signature + protNFe completo
  if (!signed.includes('<Signature')) return null
  if (!prot.startsWith('<protNFe') || !prot.endsWith('</protNFe>')) return null

  // protNFe extraído do SOAP vem sem xmlns próprio — adiciona se faltar
  const protWithNs = /^<protNFe[^>]*xmlns=/.test(prot)
    ? prot
    : prot.replace('<protNFe', `<protNFe xmlns="${NFE_NS}"`)

  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="${NFE_NS}">${signed}${protWithNs}</nfeProc>`
}
