/**
 * API de comunicação direta com SEFAZ — sem intermediários pagos
 * NF-e Modelo 55 — Layout 4.00
 *
 * Fluxo: montar XML → assinar → envelope SOAP → enviar mTLS → processar resposta
 */
export { extractCertificate, isCertificateValid } from './certificate'
export { signXml } from './xml-sign'
export { sendSoapRequest, extractSoapBody } from './soap-client'
export { getSefazEndpoints, getUfCodigo } from './urls'
export { buildNfeXml, gerarChaveAcesso } from './nfe-xml-builder'
export type { NfeData, NfeItem, NfePagamento, NfeEmitente, NfeDestinatario } from './nfe-xml-builder'
export type { CertificateData } from './certificate'
export type { SefazAmbiente, SefazEndpoints } from './urls'
