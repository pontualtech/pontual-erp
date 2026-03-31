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
import { SignedXml } from 'xml-crypto'

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
 * Usa xml-crypto para canonicalização C14N correta
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

  // Remover XML declaration para assinar apenas o corpo
  const xmlSemDecl = xml.replace(/<\?xml[^?]*\?>/, '').trim()

  // Usar xml-crypto para assinatura com canonicalização correta
  const sig = new SignedXml({
    privateKey: privateKeyPem,
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    idMode: 'wssecurity' as any,
  })

  sig.addReference({
    xpath: '/*',
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
    uri: '',
    isEmptyUri: true,
  } as any)

  sig.getKeyInfoContent = () => `<X509Data><X509Certificate>${certClean}</X509Certificate></X509Data>`

  sig.computeSignature(xmlSemDecl, {
    location: { reference: '/*', action: 'append' },
  })

  // Remover atributos Id que xml-crypto possa ter adicionado
  let signedXml = sig.getSignedXml()
  signedXml = signedXml.replace(/ Id="[^"]*"/g, '')

  return signedXml
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
