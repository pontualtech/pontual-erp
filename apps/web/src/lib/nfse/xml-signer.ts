/**
 * Assinatura digital de XML — padrão XMLDSig
 * Usa xml-crypto para canonicalização C14N correta
 */

import forge from 'node-forge'
import { SignedXml } from 'xml-crypto'

/**
 * Extrair chave privada e certificado de um arquivo .pfx (PKCS#12)
 */
export function extrairChavesCertificado(
  pfxBase64: string,
  senha: string
): { privateKeyPem: string; certPem: string; certClean: string } {
  const pfxDer = forge.util.decode64(pfxBase64)
  const pfxAsn1 = forge.asn1.fromDer(pfxDer)
  const p12 = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, senha)

  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })
  if (!keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]?.key) {
    throw new Error('Chave privada não encontrada no certificado A1')
  }

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })
  if (!certBags[forge.pki.oids.certBag]?.[0]?.cert) {
    throw new Error('Certificado não encontrado no arquivo .pfx')
  }

  const certPem = forge.pki.certificateToPem(certBags[forge.pki.oids.certBag]![0].cert!)

  return {
    privateKeyPem: forge.pki.privateKeyToPem(keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]![0].key!),
    certPem,
    certClean: certPem.replace('-----BEGIN CERTIFICATE-----', '').replace('-----END CERTIFICATE-----', '').replace(/\r?\n/g, ''),
  }
}

/**
 * Assinar XML com XMLDSig (enveloped signature) usando xml-crypto
 */
export async function assinarXml(
  xml: string,
  certificateBase64: string,
  certificatePassword: string
): Promise<string> {
  const { privateKeyPem, certClean } = extrairChavesCertificado(certificateBase64, certificatePassword)

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

  sig.getKeyInfoContent = () =>
    `<X509Data><X509Certificate>${certClean}</X509Certificate></X509Data>`

  sig.computeSignature(xml, {
    location: { reference: '/*', action: 'append' },
  })

  // Remover atributos Id que xml-crypto adiciona (SP não aceita)
  return sig.getSignedXml().replace(/ Id="[^"]*"/g, '')
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
    return {
      valido: true,
      sujeito: cert.subject.attributes.map(a => `${a.shortName}=${a.value}`).join(', '),
      emissor: cert.issuer.attributes.map(a => `${a.shortName}=${a.value}`).join(', '),
      validade_inicio: cert.validity.notBefore.toISOString(),
      validade_fim: cert.validity.notAfter.toISOString(),
      expirado: new Date() > cert.validity.notAfter,
    }
  } catch (e: any) {
    return { valido: false, sujeito: '', emissor: '', validade_inicio: '', validade_fim: '', expirado: true, erro: e.message }
  }
}
