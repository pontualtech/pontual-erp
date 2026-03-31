/**
 * Assinatura digital de XML — padrão XMLDSig
 *
 * Implementação manual usando apenas crypto nativo do Node.js
 * (não depende de xml-crypto/xmldom que podem falhar no Next.js standalone)
 *
 * Compatível com: Prefeitura de SP, SEFAZ, e outros web services gov
 */

import crypto from 'crypto'
import forge from 'node-forge'

/**
 * Extrair chave privada e certificado de um arquivo .pfx (PKCS#12)
 */
function extrairChavesCertificado(
  pfxBase64: string,
  senha: string
): { privateKeyPem: string; certPem: string } {
  const pfxDer = forge.util.decode64(pfxBase64)
  const pfxAsn1 = forge.asn1.fromDer(pfxDer)
  const p12 = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, senha)

  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })
  const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]
  if (!keyBag?.[0]?.key) {
    throw new Error('Chave privada não encontrada no certificado A1')
  }

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })
  const certBag = certBags[forge.pki.oids.certBag]
  if (!certBag?.[0]?.cert) {
    throw new Error('Certificado não encontrado no arquivo .pfx')
  }

  return {
    privateKeyPem: forge.pki.privateKeyToPem(keyBag[0].key),
    certPem: forge.pki.certificateToPem(certBag[0].cert),
  }
}

/**
 * Canonicalizar XML de forma simples (Exclusive C14N simplificada)
 *
 * Para o caso da Prefeitura de SP, o XML já é gerado sem whitespace
 * e sem atributos desordenados, então uma normalização básica é suficiente.
 */
function canonicalize(xml: string): string {
  return xml
    .replace(/<\?xml[^?]*\?>\s*/g, '')  // Remove XML declaration
    .replace(/\r\n/g, '\n')              // Normalize line endings
    .replace(/\r/g, '\n')
    .trim()
}

/**
 * Assinar XML usando XMLDSig (enveloped signature)
 *
 * Implementação manual compatível com a Prefeitura de SP:
 * - CanonicalizationMethod: Exclusive C14N
 * - SignatureMethod: RSA-SHA1
 * - DigestMethod: SHA-1
 * - Transforms: enveloped-signature + exc-c14n
 */
export async function assinarXml(
  xml: string,
  certificateBase64: string,
  certificatePassword: string
): Promise<string> {
  const { privateKeyPem, certPem } = extrairChavesCertificado(
    certificateBase64,
    certificatePassword
  )

  // Limpar o certificado para a tag X509Certificate
  const certClean = certPem
    .replace('-----BEGIN CERTIFICATE-----', '')
    .replace('-----END CERTIFICATE-----', '')
    .replace(/\r?\n/g, '')

  // Canonicalizar o XML (sem declaration)
  const xmlCanon = canonicalize(xml)

  // 1. Calcular digest SHA-1 do conteúdo canonicalizado
  const digestValue = crypto
    .createHash('sha1')
    .update(xmlCanon, 'utf8')
    .digest('base64')

  // 2. Montar o SignedInfo (canonicalizado — sem whitespace)
  const signedInfo =
    '<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">' +
    '<CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>' +
    '<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>' +
    '<Reference URI="">' +
    '<Transforms>' +
    '<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>' +
    '<Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>' +
    '</Transforms>' +
    '<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/>' +
    '<DigestValue>' + digestValue + '</DigestValue>' +
    '</Reference>' +
    '</SignedInfo>'

  // 3. Assinar o SignedInfo com RSA-SHA1
  const signer = crypto.createSign('RSA-SHA1')
  signer.update(signedInfo)
  const signatureValue = signer.sign(privateKeyPem, 'base64')

  // 4. Montar a tag Signature completa
  const signatureTag =
    '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">' +
    signedInfo +
    '<SignatureValue>' + signatureValue + '</SignatureValue>' +
    '<KeyInfo>' +
    '<X509Data><X509Certificate>' + certClean + '</X509Certificate></X509Data>' +
    '</KeyInfo>' +
    '</Signature>'

  // 5. Inserir antes do fechamento do elemento raiz
  const closeTagMatch = xmlCanon.match(/<\/[\w:]+>\s*$/)
  if (!closeTagMatch) throw new Error('XML inválido: não encontrou tag de fechamento')

  const insertPos = xmlCanon.lastIndexOf(closeTagMatch[0])
  return xmlCanon.substring(0, insertPos) + signatureTag + xmlCanon.substring(insertPos)
}

/**
 * Verificar validade do certificado
 */
export function verificarCertificado(
  certificateBase64: string,
  certificatePassword: string
): {
  valido: boolean
  sujeito: string
  emissor: string
  validade_inicio: string
  validade_fim: string
  expirado: boolean
  erro?: string
} {
  try {
    const { certPem } = extrairChavesCertificado(certificateBase64, certificatePassword)
    const cert = forge.pki.certificateFromPem(certPem)

    const now = new Date()
    const notAfter = cert.validity.notAfter
    const expirado = now > notAfter

    const sujeito = cert.subject.attributes
      .map(a => `${a.shortName}=${a.value}`)
      .join(', ')
    const emissor = cert.issuer.attributes
      .map(a => `${a.shortName}=${a.value}`)
      .join(', ')

    return {
      valido: true,
      sujeito,
      emissor,
      validade_inicio: cert.validity.notBefore.toISOString(),
      validade_fim: notAfter.toISOString(),
      expirado,
    }
  } catch (e: any) {
    return {
      valido: false,
      sujeito: '',
      emissor: '',
      validade_inicio: '',
      validade_fim: '',
      expirado: true,
      erro: e.message,
    }
  }
}
