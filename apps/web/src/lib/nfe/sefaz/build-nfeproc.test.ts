import { describe, it, expect } from 'vitest'
import { buildNfeProc } from './build-nfeproc'

// Auditoria 03/09 (NF 211): o ERP nao persistia o XML autorizado — o nfeProc
// distribuivel (NFe assinada + protNFe) precisou ser reconstruido na mao.
// Este helper monta o documento no formato distribuido oficial.
const SIGNED = '<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe versao="4.00" Id="NFe123"><ide><nNF>211</nNF></ide></infNFe><Signature xmlns="http://www.w3.org/2000/09/xmldsig#">sig</Signature></NFe>'
const PROT_SEM_NS = '<protNFe versao="4.00"><infProt><chNFe>123</chNFe><nProt>999</nProt><cStat>100</cStat></infProt></protNFe>'
const PROT_COM_NS = '<protNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><infProt><chNFe>123</chNFe><nProt>999</nProt><cStat>100</cStat></infProt></protNFe>'

describe('buildNfeProc', () => {
  it('monta nfeProc com declaracao XML, NFe assinada e protNFe', () => {
    const out = buildNfeProc(SIGNED, PROT_SEM_NS)
    expect(out).not.toBeNull()
    expect(out!.startsWith('<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">')).toBe(true)
    expect(out!.endsWith('</nfeProc>')).toBe(true)
    expect(out).toContain(SIGNED)
    expect(out).toContain('<nProt>999</nProt>')
  })
  it('adiciona xmlns ao protNFe quando falta (resposta SOAP vem sem)', () => {
    const out = buildNfeProc(SIGNED, PROT_SEM_NS)!
    expect(out).toContain('<protNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">')
  })
  it('NAO duplica xmlns quando o protNFe ja tem', () => {
    const out = buildNfeProc(SIGNED, PROT_COM_NS)!
    const matches = out.match(/<protNFe /g) || []
    expect(matches.length).toBe(1)
    expect(out).not.toMatch(/xmlns="[^"]*"[^>]*xmlns=/)
  })
  it('remove declaracao <?xml ...?> extra vinda no signedXml', () => {
    const out = buildNfeProc('<?xml version="1.0" encoding="utf-8"?>' + SIGNED, PROT_SEM_NS)!
    expect(out.indexOf('<?xml')).toBe(0)
    expect(out.lastIndexOf('<?xml')).toBe(0)
  })
  it('retorna null se faltar peca (nao persistir documento incompleto)', () => {
    expect(buildNfeProc('', PROT_SEM_NS)).toBeNull()
    expect(buildNfeProc(SIGNED, '')).toBeNull()
    expect(buildNfeProc(SIGNED, '<protNFe>sem fechamento')).toBeNull()
    // assinatura ausente = documento sem valor fiscal, nao montar
    expect(buildNfeProc('<NFe><infNFe>x</infNFe></NFe>', PROT_SEM_NS)).toBeNull()
  })
})
