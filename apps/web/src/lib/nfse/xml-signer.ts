/**
 * Assinatura digital de XML — padrão XMLDSig
 *
 * Implementação usando crypto nativo + node-forge
 * Testada com sucesso na Prefeitura de SP (NFS-e #3179, #3180, #3181)
 */

import crypto from 'crypto'
import forge from 'node-forge'

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
  const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]
  if (!keyBag?.[0]?.key) {
    throw new Error('Chave privada não encontrada no certificado A1')
  }

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })
  const certBag = certBags[forge.pki.oids.certBag]
  if (!certBag?.[0]?.cert) {
    throw new Error('Certificado não encontrado no arquivo .pfx')
  }

  const certPem = forge.pki.certificateToPem(certBag[0].cert)
  const certClean = certPem
    .replace('-----BEGIN CERTIFICATE-----', '')
    .replace('-----END CERTIFICATE-----', '')
    .replace(/\r?\n/g, '')

  return {
    privateKeyPem: forge.pki.privateKeyToPem(keyBag[0].key),
    certPem,
    certClean,
  }
}

/**
 * Assinar XML com XMLDSig (enveloped signature)
 *
 * IMPORTANTE: O XML deve ser gerado compacto (sem whitespace entre tags)
 * porque o digest é calculado sobre o XML exato.
 *
 * Fluxo:
 * 1. Calcular digest SHA-1 do XML (sem declaration, sem Signature)
 * 2. Montar SignedInfo com o digest
 * 3. Assinar o SignedInfo com RSA-SHA1
 * 4. Inserir <Signature> antes do fechamento do root
 */
export async function assinarXml(
  xml: string,
  certificateBase64: string,
  certificatePassword: string
): Promise<string> {
  const { privateKeyPem, certClean } = extrairChavesCertificado(
    certificateBase64,
    certificatePassword
  )

  // Remover XML declaration se houver
  const xmlBody = xml.replace(/<\?xml[^?]*\?>\s*/g, '').trim()

  // 1. Digest SHA-1 do XML body (é isso que a prefeitura verifica)
  const digestValue = crypto
    .createHash('sha1')
    .update(xmlBody, 'utf8')
    .digest('base64')

  // 2. SignedInfo — DEVE ser string compacta sem quebra de linha
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

  // 3. Assinar o SignedInfo
  const signer = crypto.createSign('RSA-SHA1')
  signer.update(signedInfo)
  const signatureValue = signer.sign(privateKeyPem, 'base64')

  // 4. Montar Signature completa
  const signatureXml =
    '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">' +
    signedInfo +
    '<SignatureValue>' + signatureValue + '</SignatureValue>' +
    '<KeyInfo><X509Data><X509Certificate>' + certClean + '</X509Certificate></X509Data></KeyInfo>' +
    '</Signature>'

  // 5. Inserir antes do fechamento do elemento raiz
  // Para PedidoEnvioRPS, inserir antes de </PedidoEnvioRPS>
  // Para outros, antes da última tag de fechamento do root
  const rootCloseMatch = xmlBody.match(/<\/[^>]+>\s*$/)
  if (!rootCloseMatch) throw new Error('XML inválido: sem tag de fechamento')

  const insertPos = xmlBody.lastIndexOf(rootCloseMatch[0])
  return xmlBody.substring(0, insertPos) + signatureXml + xmlBody.substring(insertPos)
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
