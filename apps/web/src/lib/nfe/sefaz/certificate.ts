/**
 * Manipulação de certificado digital A1 (PFX/P12)
 * Extrai chave privada e certificado para assinatura XML e mTLS
 */
import * as forge from 'node-forge'

export interface CertificateData {
  privateKeyPem: string
  certificatePem: string
  cnpj: string
  razaoSocial: string
  validFrom: Date
  validTo: Date
}

/**
 * Extrai dados do certificado A1 (PFX/P12) a partir de base64
 */
export function extractCertificate(pfxBase64: string, password: string): CertificateData {
  const pfxDer = forge.util.decode64(pfxBase64)
  const pfxAsn1 = forge.asn1.fromDer(pfxDer)
  const p12 = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, password)

  // Extrair chave privada
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })
  const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]
  if (!keyBag?.key) throw new Error('Chave privada não encontrada no certificado')

  const privateKeyPem = forge.pki.privateKeyToPem(keyBag.key)

  // Extrair certificado
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })
  const certBag = certBags[forge.pki.oids.certBag]?.[0]
  if (!certBag?.cert) throw new Error('Certificado não encontrado no PFX')

  const cert = certBag.cert
  const certificatePem = forge.pki.certificateToPem(cert)

  // Extrair CNPJ do subject
  const cnAttr = cert.subject.getField('CN')
  const cnValue = cnAttr?.value || ''
  // CNPJ está geralmente no CN: "EMPRESA LTDA:12345678000199"
  const cnpjMatch = cnValue.match(/(\d{14})/)
  const cnpj = cnpjMatch?.[1] || ''

  // Razão social
  const razaoSocial = cnValue.split(':')[0]?.trim() || ''

  return {
    privateKeyPem,
    certificatePem,
    cnpj,
    razaoSocial,
    validFrom: cert.validity.notBefore,
    validTo: cert.validity.notAfter,
  }
}

/**
 * Verifica se o certificado ainda é válido
 */
export function isCertificateValid(cert: CertificateData): boolean {
  const now = new Date()
  return now >= cert.validFrom && now <= cert.validTo
}
