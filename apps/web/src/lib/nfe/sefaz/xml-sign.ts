/**
 * Assinatura digital de XML NF-e com certificado A1
 * Padrão: XML-DSig (Enveloped Signature) — RSA-SHA1 / C14N
 */
import { SignedXml } from 'xml-crypto'

/**
 * Assina um XML NF-e no padrão exigido pela SEFAZ
 */
export function signXml(
  xml: string,
  privateKeyPem: string,
  certificatePem: string,
  tagToSign: string = 'infNFe'
): string {
  // Extrair o certificado base64 (sem headers PEM)
  const certBase64 = certificatePem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\n/g, '')
    .trim()

  const sig = new SignedXml({
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    privateKey: privateKeyPem,
    publicCert: certificatePem,
    getKeyInfoContent: () => `<X509Data><X509Certificate>${certBase64}</X509Certificate></X509Data>`,
  })

  // Referência à tag a ser assinada
  sig.addReference({
    xpath: `//*[local-name(.)='${tagToSign}']`,
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
  })

  // Computar assinatura
  sig.computeSignature(xml, {
    location: { reference: `//*[local-name(.)='${tagToSign}']`, action: 'after' },
  })

  return sig.getSignedXml()
}
