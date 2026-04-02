/**
 * URLs dos Web Services da SEFAZ por UF e ambiente
 * NF-e Modelo 55 — Layout 4.00
 *
 * Referência: https://www.nfe.fazenda.gov.br/portal/webServices.aspx
 */

export type SefazAmbiente = '1' | '2' // 1=Produção, 2=Homologação

export interface SefazEndpoints {
  autorizacao: string
  retAutorizacao: string
  consultaProtocolo: string
  inutilizacao: string
  recepcaoEvento: string
  statusServico: string
  consultaCadastro?: string
  distribuicaoDFe: string
}

// SEFAZ SP (UF 35) — SVRS para maioria
const SP_PRODUCAO: SefazEndpoints = {
  autorizacao: 'https://nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx',
  retAutorizacao: 'https://nfe.fazenda.sp.gov.br/ws/nferetautorizacao4.asmx',
  consultaProtocolo: 'https://nfe.fazenda.sp.gov.br/ws/nfeconsultaprotocolo4.asmx',
  inutilizacao: 'https://nfe.fazenda.sp.gov.br/ws/nfeinutilizacao4.asmx',
  recepcaoEvento: 'https://nfe.fazenda.sp.gov.br/ws/nferecepcaoevento4.asmx',
  statusServico: 'https://nfe.fazenda.sp.gov.br/ws/nfestatusservico4.asmx',
  consultaCadastro: 'https://nfe.fazenda.sp.gov.br/ws/cadconsultacadastro4.asmx',
  distribuicaoDFe: 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
}

const SP_HOMOLOGACAO: SefazEndpoints = {
  autorizacao: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx',
  retAutorizacao: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nferetautorizacao4.asmx',
  consultaProtocolo: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeconsultaprotocolo4.asmx',
  inutilizacao: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeinutilizacao4.asmx',
  recepcaoEvento: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nferecepcaoevento4.asmx',
  statusServico: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfestatusservico4.asmx',
  distribuicaoDFe: 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
}

// SVRS (maioria dos estados)
const SVRS_PRODUCAO: SefazEndpoints = {
  autorizacao: 'https://nfe.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
  retAutorizacao: 'https://nfe.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
  consultaProtocolo: 'https://nfe.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
  inutilizacao: 'https://nfe.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx',
  recepcaoEvento: 'https://nfe.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
  statusServico: 'https://nfe.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  distribuicaoDFe: 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
}

const SVRS_HOMOLOGACAO: SefazEndpoints = {
  autorizacao: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
  retAutorizacao: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx',
  consultaProtocolo: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
  inutilizacao: 'https://nfe-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx',
  recepcaoEvento: 'https://nfe-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
  statusServico: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  distribuicaoDFe: 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
}

// Mapa UF → autorizador
const UF_AUTORIZADOR: Record<string, string> = {
  '11': 'SVRS', // RO
  '12': 'SVRS', // AC
  '13': 'AM',   // AM
  '14': 'SVRS', // RR
  '15': 'SVRS', // PA
  '16': 'SVRS', // AP
  '17': 'SVRS', // TO
  '21': 'SVRS', // MA
  '22': 'SVRS', // PI
  '23': 'SVRS', // CE
  '24': 'SVRS', // RN
  '25': 'SVRS', // PB
  '26': 'PE',   // PE
  '27': 'SVRS', // AL
  '28': 'SVRS', // SE
  '29': 'BA',   // BA
  '31': 'MG',   // MG
  '32': 'SVRS', // ES
  '33': 'SVRS', // RJ
  '35': 'SP',   // SP
  '41': 'PR',   // PR
  '42': 'SVRS', // SC
  '43': 'RS',   // RS
  '50': 'MS',   // MS
  '51': 'MT',   // MT
  '52': 'GO',   // GO
  '53': 'SVRS', // DF
}

export function getSefazEndpoints(uf: string, ambiente: SefazAmbiente): SefazEndpoints {
  const autorizador = UF_AUTORIZADOR[uf] || 'SVRS'

  // SP tem autorizador próprio
  if (autorizador === 'SP') {
    return ambiente === '1' ? SP_PRODUCAO : SP_HOMOLOGACAO
  }

  // Demais usam SVRS (simplificação — na prática MG, BA, PR, GO, MT, MS, RS, PE, AM têm próprio)
  return ambiente === '1' ? SVRS_PRODUCAO : SVRS_HOMOLOGACAO
}

export function getUfCodigo(uf: string): string {
  const map: Record<string, string> = {
    AC: '12', AL: '27', AM: '13', AP: '16', BA: '29', CE: '23', DF: '53',
    ES: '32', GO: '52', MA: '21', MG: '31', MS: '50', MT: '51', PA: '15',
    PB: '25', PE: '26', PI: '22', PR: '41', RJ: '33', RN: '24', RO: '11',
    RR: '14', RS: '43', SC: '42', SE: '28', SP: '35', TO: '17',
  }
  return map[uf.toUpperCase()] || '35'
}
