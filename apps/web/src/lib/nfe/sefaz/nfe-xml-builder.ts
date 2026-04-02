/**
 * Gerador de XML NF-e modelo 55 — Layout 4.00
 * Constrói o XML completo para autorização na SEFAZ
 */
import { getUfCodigo } from './urls'

export interface NfeEmitente {
  cnpj: string
  razaoSocial: string
  nomeFantasia?: string
  inscricaoEstadual: string
  inscricaoMunicipal?: string
  cnae?: string
  crt: '1' | '2' | '3' // 1=Simples, 2=SN Excesso, 3=Normal
  endereco: {
    logradouro: string
    numero: string
    complemento?: string
    bairro: string
    codigoMunicipio: string
    municipio: string
    uf: string
    cep: string
    pais?: string
    codigoPais?: string
    telefone?: string
  }
}

export interface NfeDestinatario {
  cpfCnpj: string
  razaoSocial: string
  inscricaoEstadual?: string
  email?: string
  endereco: {
    logradouro: string
    numero: string
    complemento?: string
    bairro: string
    codigoMunicipio: string
    municipio: string
    uf: string
    cep: string
  }
  indIEDest?: '1' | '2' | '9' // 1=contribuinte, 2=isento, 9=não contribuinte
}

export interface NfeItem {
  numero: number
  codigoProduto: string
  descricao: string
  ncm: string
  cfop: string
  unidade: string
  quantidade: number
  valorUnitario: number // em reais (decimal)
  valorTotal: number    // em reais
  // Impostos simplificados
  origemMercadoria?: '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8'
  csosn?: string // para Simples Nacional (ex: '102', '500')
  cst?: string   // para regime normal
  aliquotaICMS?: number
  valorICMS?: number
  cstPIS?: string
  cstCOFINS?: string
}

export interface NfePagamento {
  forma: string   // '01'=dinheiro, '03'=cartao credito, '04'=cartao debito, '15'=PIX, '99'=outros
  valor: number   // em reais
}

export interface NfeData {
  // Identificação
  numero: number
  serie: string
  dataEmissao: Date
  tipoOperacao: '0' | '1' // 0=entrada, 1=saída
  destino: '1' | '2' | '3' // 1=interna, 2=interestadual, 3=exterior
  naturezaOperacao: string // ex: 'VENDA DE MERCADORIA', 'DEVOLUCAO'
  finalidade: '1' | '2' | '3' | '4' // 1=normal, 2=complementar, 3=ajuste, 4=devolução
  presencaComprador: '0' | '1' | '2' | '3' | '4' | '5' | '9'
  // Partes
  emitente: NfeEmitente
  destinatario: NfeDestinatario
  // Itens
  items: NfeItem[]
  // Pagamento
  pagamentos: NfePagamento[]
  // Totais
  valorProdutos: number
  valorNfe: number
  // Informações complementares
  informacoesAdicionais?: string
  // Referências
  chavesReferenciadas?: string[]
}

/**
 * Gera o código numérico aleatório da NF-e (8 dígitos)
 */
function gerarCodigoNumerico(): string {
  return String(Math.floor(Math.random() * 100000000)).padStart(8, '0')
}

/**
 * Calcula o dígito verificador da chave de acesso (módulo 11)
 */
function calcularDV(chave43: string): string {
  const pesos = [2, 3, 4, 5, 6, 7, 8, 9]
  let soma = 0
  let idx = 0
  for (let i = chave43.length - 1; i >= 0; i--) {
    soma += parseInt(chave43[i]) * pesos[idx % 8]
    idx++
  }
  const resto = soma % 11
  const dv = resto < 2 ? 0 : 11 - resto
  return String(dv)
}

/**
 * Gera a chave de acesso da NF-e (44 dígitos)
 */
export function gerarChaveAcesso(
  uf: string, aamm: string, cnpj: string,
  modelo: string, serie: string, numero: number,
  tipoEmissao: string, codigoNumerico: string
): string {
  const cUF = getUfCodigo(uf)
  const nNF = String(numero).padStart(9, '0')
  const ser = serie.padStart(3, '0')
  const chave43 = `${cUF}${aamm}${cnpj.padStart(14, '0')}${modelo}${ser}${nNF}${tipoEmissao}${codigoNumerico}`
  const dv = calcularDV(chave43)
  return chave43 + dv
}

/**
 * Monta o XML completo da NF-e (sem assinatura)
 */
export function buildNfeXml(nfe: NfeData): { xml: string; chaveAcesso: string } {
  const cNF = gerarCodigoNumerico()
  const uf = nfe.emitente.endereco.uf
  const aamm = `${String(nfe.dataEmissao.getFullYear()).slice(2)}${String(nfe.dataEmissao.getMonth() + 1).padStart(2, '0')}`
  const cnpj14 = nfe.emitente.cnpj.padStart(14, '0')
  const tpEmis = '1' // emissão normal
  const chave = gerarChaveAcesso(uf, aamm, cnpj14, '55', nfe.serie, nfe.numero, tpEmis, cNF)
  const cUF = getUfCodigo(uf)
  const dhEmi = nfe.dataEmissao.toISOString().replace(/\.\d{3}Z$/, '-03:00')
  const nNF = String(nfe.numero).padStart(9, '0')
  const ser = nfe.serie.padStart(3, '0')

  const dest = nfe.destinatario
  const isDocCnpj = dest.cpfCnpj.replace(/\D/g, '').length === 14
  const docTag = isDocCnpj ? 'CNPJ' : 'CPF'
  const docValue = dest.cpfCnpj.replace(/\D/g, '')

  // Items XML
  const itemsXml = nfe.items.map(item => {
    const orig = item.origemMercadoria || '0'
    const isSimples = nfe.emitente.crt === '1' || nfe.emitente.crt === '2'

    return `<det nItem="${item.numero}">
      <prod>
        <cProd>${item.codigoProduto}</cProd>
        <cEAN>SEM GTIN</cEAN>
        <xProd>${escapeXml(item.descricao)}</xProd>
        <NCM>${item.ncm}</NCM>
        <CFOP>${item.cfop}</CFOP>
        <uCom>${item.unidade}</uCom>
        <qCom>${item.quantidade.toFixed(4)}</qCom>
        <vUnCom>${item.valorUnitario.toFixed(10)}</vUnCom>
        <vProd>${item.valorTotal.toFixed(2)}</vProd>
        <cEANTrib>SEM GTIN</cEANTrib>
        <uTrib>${item.unidade}</uTrib>
        <qTrib>${item.quantidade.toFixed(4)}</qTrib>
        <vUnTrib>${item.valorUnitario.toFixed(10)}</vUnTrib>
        <indTot>1</indTot>
      </prod>
      <imposto>
        <ICMS>${isSimples
          ? `<ICMSSN${item.csosn || '102'}><orig>${orig}</orig><CSOSN>${item.csosn || '102'}</CSOSN></ICMSSN${item.csosn || '102'}>`
          : `<ICMS00><orig>${orig}</orig><CST>00</CST><modBC>3</modBC><vBC>${item.valorTotal.toFixed(2)}</vBC><pICMS>${(item.aliquotaICMS || 0).toFixed(2)}</pICMS><vICMS>${(item.valorICMS || 0).toFixed(2)}</vICMS></ICMS00>`
        }</ICMS>
        <PIS><PISOutr><CST>${item.cstPIS || '99'}</CST><vBC>0.00</vBC><pPIS>0.00</pPIS><vPIS>0.00</vPIS></PISOutr></PIS>
        <COFINS><COFINSOutr><CST>${item.cstCOFINS || '99'}</CST><vBC>0.00</vBC><pCOFINS>0.00</pCOFINS><vCOFINS>0.00</vCOFINS></COFINSOutr></COFINS>
      </imposto>
    </det>`
  }).join('\n')

  // Pagamentos
  const pagXml = nfe.pagamentos.map(pag =>
    `<detPag><tPag>${pag.forma}</tPag><vPag>${pag.valor.toFixed(2)}</vPag></detPag>`
  ).join('\n')

  // Referências
  const refXml = (nfe.chavesReferenciadas || []).map(ch =>
    `<NFref><refNFe>${ch}</refNFe></NFref>`
  ).join('')

  const xml = `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe versao="4.00" Id="NFe${chave}">
    <ide>
      <cUF>${cUF}</cUF>
      <cNF>${cNF}</cNF>
      <natOp>${escapeXml(nfe.naturezaOperacao)}</natOp>
      <mod>55</mod>
      <serie>${ser}</serie>
      <nNF>${nNF}</nNF>
      <dhEmi>${dhEmi}</dhEmi>
      <tpNF>${nfe.tipoOperacao}</tpNF>
      <idDest>${nfe.destino}</idDest>
      <cMunFG>${nfe.emitente.endereco.codigoMunicipio}</cMunFG>
      <tpImp>1</tpImp>
      <tpEmis>${tpEmis}</tpEmis>
      <cDV>${chave.slice(-1)}</cDV>
      <tpAmb>2</tpAmb>
      <finNFe>${nfe.finalidade}</finNFe>
      <indFinal>1</indFinal>
      <indPres>${nfe.presencaComprador}</indPres>
      <procEmi>0</procEmi>
      <verProc>PontualERP 1.0</verProc>
      ${refXml}
    </ide>
    <emit>
      <CNPJ>${cnpj14}</CNPJ>
      <xNome>${escapeXml(nfe.emitente.razaoSocial)}</xNome>
      ${nfe.emitente.nomeFantasia ? `<xFant>${escapeXml(nfe.emitente.nomeFantasia)}</xFant>` : ''}
      <enderEmit>
        <xLgr>${escapeXml(nfe.emitente.endereco.logradouro)}</xLgr>
        <nro>${nfe.emitente.endereco.numero}</nro>
        ${nfe.emitente.endereco.complemento ? `<xCpl>${escapeXml(nfe.emitente.endereco.complemento)}</xCpl>` : ''}
        <xBairro>${escapeXml(nfe.emitente.endereco.bairro)}</xBairro>
        <cMun>${nfe.emitente.endereco.codigoMunicipio}</cMun>
        <xMun>${escapeXml(nfe.emitente.endereco.municipio)}</xMun>
        <UF>${uf}</UF>
        <CEP>${nfe.emitente.endereco.cep.replace(/\D/g, '')}</CEP>
        <cPais>1058</cPais>
        <xPais>BRASIL</xPais>
        ${nfe.emitente.endereco.telefone ? `<fone>${nfe.emitente.endereco.telefone.replace(/\D/g, '')}</fone>` : ''}
      </enderEmit>
      <IE>${nfe.emitente.inscricaoEstadual.replace(/\D/g, '')}</IE>
      <CRT>${nfe.emitente.crt}</CRT>
    </emit>
    <dest>
      <${docTag}>${docValue}</${docTag}>
      <xNome>${escapeXml(dest.razaoSocial)}</xNome>
      <enderDest>
        <xLgr>${escapeXml(dest.endereco.logradouro)}</xLgr>
        <nro>${dest.endereco.numero}</nro>
        ${dest.endereco.complemento ? `<xCpl>${escapeXml(dest.endereco.complemento)}</xCpl>` : ''}
        <xBairro>${escapeXml(dest.endereco.bairro)}</xBairro>
        <cMun>${dest.endereco.codigoMunicipio}</cMun>
        <xMun>${escapeXml(dest.endereco.municipio)}</xMun>
        <UF>${dest.endereco.uf}</UF>
        <CEP>${dest.endereco.cep.replace(/\D/g, '')}</CEP>
        <cPais>1058</cPais>
        <xPais>BRASIL</xPais>
      </enderDest>
      <indIEDest>${dest.indIEDest || '9'}</indIEDest>
      ${dest.email ? `<email>${dest.email}</email>` : ''}
    </dest>
    ${itemsXml}
    <total>
      <ICMSTot>
        <vBC>0.00</vBC>
        <vICMS>0.00</vICMS>
        <vICMSDeson>0.00</vICMSDeson>
        <vFCPUFDest>0.00</vFCPUFDest>
        <vICMSUFDest>0.00</vICMSUFDest>
        <vICMSUFRemet>0.00</vICMSUFRemet>
        <vFCP>0.00</vFCP>
        <vBCST>0.00</vBCST>
        <vST>0.00</vST>
        <vFCPST>0.00</vFCPST>
        <vFCPSTRet>0.00</vFCPSTRet>
        <vProd>${nfe.valorProdutos.toFixed(2)}</vProd>
        <vFrete>0.00</vFrete>
        <vSeg>0.00</vSeg>
        <vDesc>0.00</vDesc>
        <vII>0.00</vII>
        <vIPI>0.00</vIPI>
        <vIPIDevol>0.00</vIPIDevol>
        <vPIS>0.00</vPIS>
        <vCOFINS>0.00</vCOFINS>
        <vOutro>0.00</vOutro>
        <vNF>${nfe.valorNfe.toFixed(2)}</vNF>
      </ICMSTot>
    </total>
    <transp>
      <modFrete>9</modFrete>
    </transp>
    <pag>
      ${pagXml}
    </pag>
    ${nfe.informacoesAdicionais ? `<infAdic><infCpl>${escapeXml(nfe.informacoesAdicionais)}</infCpl></infAdic>` : ''}
  </infNFe>
</NFe>`

  return { xml, chaveAcesso: chave }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
