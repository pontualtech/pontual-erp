/**
 * Assinatura digital de XML — padrão XMLDSig
 *
 * Usa certificado A1 (.pfx/.p12) para:
 * 1. Canonicalizar o XML (Exclusive C14N)
 * 2. Calcular digest SHA-1 do conteúdo
 * 3. Assinar com RSA-SHA1 (chave privada do certificado)
 * 4. Inserir tag <Signature> no XML
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

  // Extrair chave privada
  let privateKey: forge.pki.PrivateKey | null = null
  const bags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })
  const keyBag = bags[forge.pki.oids.pkcs8ShroudedKeyBag]
  if (keyBag && keyBag.length > 0 && keyBag[0].key) {
    privateKey = keyBag[0].key
  }

  if (!privateKey) {
    // Tentar via friendlyName
    const allBags = p12.getBags({ bagType: forge.pki.oids.certBag })
    throw new Error('Chave privada não encontrada no certificado. Verifique se é um certificado A1 válido.')
  }

  // Extrair certificado
  let cert: forge.pki.Certificate | null = null
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })
  const certBag = certBags[forge.pki.oids.certBag]
  if (certBag && certBag.length > 0 && certBag[0].cert) {
    cert = certBag[0].cert
  }

  if (!cert) {
    throw new Error('Certificado não encontrado no arquivo .pfx')
  }

  return {
    privateKeyPem: forge.pki.privateKeyToPem(privateKey),
    certPem: forge.pki.certificateToPem(cert),
  }
}

/**
 * Assinar XML usando XMLDSig (enveloped signature)
 *
 * O padrão da Prefeitura de SP usa:
 * - CanonicalizationMethod: http://www.w3.org/2001/10/xml-exc-c14n#
 * - SignatureMethod: http://www.w3.org/2000/09/xmldsig#rsa-sha1
 * - DigestMethod: http://www.w3.org/2000/09/xmldsig#sha1
 * - Transform: enveloped-signature + exc-c14n
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

  // Limpar o certificado para a tag X509Certificate (sem headers PEM)
  const certClean = certPem
    .replace('-----BEGIN CERTIFICATE-----', '')
    .replace('-----END CERTIFICATE-----', '')
    .replace(/\r?\n/g, '')

  // Encontrar o elemento raiz para referenciar
  const rootMatch = xml.match(/<(\w+:)?(\w+)[\s>]/)
  if (!rootMatch) throw new Error('XML inválido: não encontrou elemento raiz')

  // Para SP: a referência é vazia (URI="") = assinar documento inteiro
  const xmlSemDeclaration = xml.replace(/<\?xml[^?]*\?>/, '').trim()

  // 1. Calcular digest do conteúdo (sem a Signature que será adicionada)
  const digestValue = crypto
    .createHash('sha1')
    .update(xmlSemDeclaration, 'utf8')
    .digest('base64')

  // 2. Montar o SignedInfo (que será assinado)
  const signedInfo = `<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/><SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/><Reference URI=""><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/><Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/></Transforms><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/><DigestValue>${digestValue}</DigestValue></Reference></SignedInfo>`

  // 3. Assinar o SignedInfo com RSA-SHA1
  const signer = crypto.createSign('RSA-SHA1')
  signer.update(signedInfo)
  const signatureValue = signer.sign(privateKeyPem, 'base64')

  // 4. Montar a tag Signature completa
  const signatureTag = `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">${signedInfo}<SignatureValue>${signatureValue}</SignatureValue><KeyInfo><X509Data><X509Certificate>${certClean}</X509Certificate></X509Data></KeyInfo></Signature>`

  // 5. Inserir antes do fechamento do elemento raiz
  const closeTagMatch = xml.match(/<\/(\w+:)?\w+>\s*$/)
  if (!closeTagMatch) throw new Error('XML inválido: não encontrou tag de fechamento')

  const insertPos = xml.lastIndexOf(closeTagMatch[0])
  const xmlAssinado = xml.substring(0, insertPos) + signatureTag + xml.substring(insertPos)

  return xmlAssinado
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
    const notBefore = cert.validity.notBefore
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
      validade_inicio: notBefore.toISOString(),
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
