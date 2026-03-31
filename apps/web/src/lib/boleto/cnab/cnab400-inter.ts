/**
 * Gerador de arquivo de remessa CNAB 400 — Banco Inter (077)
 * Layout V7 — 15/01/2026
 *
 * Padrão: CNAB Inter 400 posicional (400 caracteres por linha)
 * Carteira 112 — Inter gera nosso número automaticamente
 * Arquivo: CI400_001_XXXXXXX.REM
 *
 * Estrutura:
 * - Header (tipo 0) — obrigatório
 * - Transação Tipo 1 (por boleto) — obrigatório
 * - Transação Tipo 3 (por boleto) — opcional (email do pagador)
 * - Trailer (tipo 9) — obrigatório
 */

// ====== Tipos ======

export interface BoletoRemessa400 {
  seuNumero: string             // Identificação interna (max 10 chars)
  dataVencimento: Date
  valorNominal: number          // em centavos
  diasAposVencimento: number    // dias que aceita pagamento após vencer (1-60)
  // Pagador
  sacadoNome: string
  sacadoDocumento: string       // CPF ou CNPJ (só números)
  sacadoEndereco: string
  sacadoUF: string
  sacadoCEP: string
  sacadoEmail?: string          // Inter envia boleto por email automaticamente!
  // Multa
  multa?: { tipo: '0' | '1' | '2'; valor?: number; percentual?: number; data?: Date }
  // Juros
  juros?: { tipo: '0' | '1' | '2'; valorDia?: number; taxaMensal?: number; data?: Date }
  // Desconto
  desconto?: { tipo: '0' | '1' | '4'; valor?: number; percentual?: number; dataLimite?: Date }
  // Mensagem livre (impressa no boleto)
  mensagem?: string
  // Controle
  controleParticipante?: string  // max 25 chars
}

export interface CedenteConfig400 {
  razaoSocial: string
  agencia: string               // "0001"
  conta: string                 // sem DV (ex: "004025073")
  contaDV: string               // DV (ex: "3")
  carteira: string              // "112"
}

export interface RetornoBoleto400 {
  nossoNumero: string
  seuNumero: string
  dataOcorrencia: Date | null
  dataVencimento: Date | null
  dataCredito: Date | null
  valorTitulo: number           // centavos
  valorPago: number             // centavos
  ocorrencia: string            // código 2 dígitos
  ocorrenciaDescricao: string
  nomePagador: string
  cpfCnpjPagador: string
  motivoRejeicao: string
  numeroOperacao: string
  status: 'REGISTRADO' | 'PAGO' | 'REJEITADO' | 'CANCELADO' | 'OUTRO'
}

// ====== Helpers ======

function padNum(value: string | number, length: number): string {
  return String(value).padStart(length, '0').substring(0, length)
}

function padAlfa(value: string, length: number): string {
  return value
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .substring(0, length)
    .padEnd(length, ' ')
}

function formatDateDDMMAA(date: Date): string {
  const d = date.getDate().toString().padStart(2, '0')
  const m = (date.getMonth() + 1).toString().padStart(2, '0')
  const y = date.getFullYear().toString().substring(2)
  return d + m + y
}

function limparDoc(doc: string): string {
  return doc.replace(/[.\-\/]/g, '')
}

// ====== Gerador CNAB 400 ======

export function gerarRemessaCNAB400(
  cedente: CedenteConfig400,
  boletos: BoletoRemessa400[],
  sequencialArquivo: number = 1
): { conteudo: string; nomeArquivo: string } {
  const lines: string[] = []
  const now = new Date()
  let seqRegistro = 1

  // ====== HEADER (tipo 0) — 400 bytes ======
  let h = ''
  h += '0'                                          // 001: Tipo registro
  h += '1'                                          // 002: Arquivo remessa
  h += padAlfa('REMESSA', 7)                        // 003-009: Literal
  h += '01'                                         // 010-011: Código serviço
  h += padAlfa('COBRANCA', 15)                      // 012-026: Literal serviço
  h += padAlfa('', 20)                              // 027-046: Branco
  h += padAlfa(cedente.razaoSocial, 30)             // 047-076: Nome empresa
  h += '077'                                        // 077-079: Código banco
  h += padAlfa('INTER', 15)                         // 080-094: Nome banco
  h += formatDateDDMMAA(now)                        // 095-100: Data gravação
  h += padAlfa('', 10)                              // 101-110: Branco
  h += padNum(sequencialArquivo, 7)                 // 111-117: Seq. remessa
  h += padAlfa('', 277)                             // 118-394: Branco
  h += padNum(seqRegistro, 6)                       // 395-400: Seq. registro
  lines.push(h)

  // ====== TRANSAÇÕES ======
  for (const boleto of boletos) {
    seqRegistro++
    const docLimpo = limparDoc(boleto.sacadoDocumento)
    const tipoDoc = docLimpo.length <= 11 ? '01' : '02'
    const contaPad = padNum(cedente.conta.replace(/\D/g, ''), 9)
    const contaDV = cedente.contaDV || '0'

    // Multa
    const multaTipo = boleto.multa?.tipo || '0'
    let multaValor = padNum(0, 13)
    let multaPct = padNum(0, 4)
    let multaData = padNum(0, 6)
    if (multaTipo === '1' && boleto.multa?.valor) {
      multaValor = padNum(boleto.multa.valor, 13)
    }
    if (multaTipo === '2' && boleto.multa?.percentual) {
      multaPct = padNum(Math.round(boleto.multa.percentual * 100), 4)
      if (boleto.multa?.data) multaData = formatDateDDMMAA(boleto.multa.data)
      else {
        const d = new Date(boleto.dataVencimento); d.setDate(d.getDate() + 1)
        multaData = formatDateDDMMAA(d)
      }
    }
    if (multaTipo !== '0' && boleto.multa?.data) multaData = formatDateDDMMAA(boleto.multa.data)

    // Juros
    const jurosTipo = boleto.juros?.tipo || '0'
    let jurosValorDia = padNum(0, 13)
    let jurosTaxaMensal = padNum(0, 4)
    let jurosData = padNum(0, 6)
    if (jurosTipo === '1' && boleto.juros?.valorDia) {
      jurosValorDia = padNum(boleto.juros.valorDia, 13)
    }
    if (jurosTipo === '2' && boleto.juros?.taxaMensal) {
      jurosTaxaMensal = padNum(Math.round(boleto.juros.taxaMensal * 100), 4)
    }
    if (jurosTipo !== '0') {
      if (boleto.juros?.data) jurosData = formatDateDDMMAA(boleto.juros.data)
      else {
        const d = new Date(boleto.dataVencimento); d.setDate(d.getDate() + 1)
        jurosData = formatDateDDMMAA(d)
      }
    }

    // Desconto
    const descontoTipo = boleto.desconto?.tipo || '0'
    let descontoValor = padNum(0, 13)
    let descontoPct = padNum(0, 4)
    let descontoData = padNum(0, 6)
    if (descontoTipo === '1' && boleto.desconto?.valor) descontoValor = padNum(boleto.desconto.valor, 13)
    if (descontoTipo === '4' && boleto.desconto?.percentual) descontoPct = padNum(Math.round(boleto.desconto.percentual * 100), 4)
    if (descontoTipo !== '0' && boleto.desconto?.dataLimite) descontoData = formatDateDDMMAA(boleto.desconto.dataLimite)

    // ------ TIPO 1 (obrigatório) ------
    let t1 = ''
    t1 += '1'                                       // 001: Tipo registro
    t1 += padAlfa('', 19)                           // 002-020: Branco
    t1 += padNum(cedente.carteira, 3)               // 021-023: Carteira
    t1 += padNum(cedente.agencia, 4)                // 024-027: Agência
    t1 += contaPad                                  // 028-036: Conta (9 dig)
    t1 += contaDV                                   // 037: DV conta
    t1 += padAlfa(boleto.controleParticipante || boleto.seuNumero, 25) // 038-062: Controle
    t1 += '001'                                     // 063-065: Formato cobrança (boleto)
    t1 += multaTipo                                 // 066: Campo multa
    t1 += multaValor                                // 067-079: Valor multa
    t1 += multaPct                                  // 080-083: Percentual multa
    t1 += multaData                                 // 084-089: Data multa
    t1 += padNum(0, 11)                             // 090-100: Nosso número (zeros = carteira 112)
    t1 += padAlfa('', 8)                            // 101-108: Branco
    t1 += '01'                                      // 109-110: Ocorrência (01=Remessa)
    t1 += padAlfa(boleto.seuNumero, 10)             // 111-120: Seu número
    t1 += formatDateDDMMAA(boleto.dataVencimento)   // 121-126: Vencimento
    t1 += padNum(boleto.valorNominal, 13)           // 127-139: Valor (2 dec, sem vírgula)
    t1 += padNum(Math.min(60, Math.max(1, boleto.diasAposVencimento || 30)), 2) // 140-141: Dias após venc
    t1 += padAlfa('', 6)                            // 142-147: Branco
    t1 += '01'                                      // 148-149: Espécie título
    t1 += 'N'                                       // 150: Identificação
    t1 += padAlfa('', 6)                            // 151-156: Data emissão (branco)
    t1 += padAlfa('', 3)                            // 157-159: Branco
    t1 += jurosTipo                                 // 160: Campo juros
    t1 += jurosValorDia                             // 161-173: Valor juros/dia
    t1 += jurosTaxaMensal                           // 174-177: Taxa mensal
    t1 += jurosData                                 // 178-183: Data mora
    t1 += descontoTipo                              // 184: Campo desconto
    t1 += descontoValor                             // 185-197: Valor desconto
    t1 += descontoPct                               // 198-201: Percentual desconto
    t1 += descontoData                              // 202-207: Data limite desconto
    t1 += padNum(0, 13)                             // 208-220: Branco (zeros)
    t1 += tipoDoc                                   // 221-222: Tipo inscr. pagador
    t1 += padNum(docLimpo, 14)                      // 223-236: CPF/CNPJ
    t1 += padAlfa(boleto.sacadoNome, 40)            // 237-276: Nome pagador
    t1 += padAlfa(boleto.sacadoEndereco, 38)        // 277-314: Endereço
    t1 += padAlfa(boleto.sacadoUF, 2)               // 315-316: UF
    t1 += padNum(limparDoc(boleto.sacadoCEP || '00000000'), 8) // 317-324: CEP
    t1 += padAlfa(boleto.mensagem || '', 70)        // 325-394: 1ª mensagem
    t1 += padNum(seqRegistro, 6)                    // 395-400: Seq. registro
    lines.push(t1)

    // ------ TIPO 3 (opcional — email do pagador) ------
    if (boleto.sacadoEmail) {
      seqRegistro++
      let t3 = ''
      t3 += '3'                                     // 001: Tipo registro
      t3 += padAlfa(boleto.sacadoEmail, 50)         // 002-051: Email pagador
      t3 += padAlfa('', 10)                         // 052-061: Branco
      t3 += padAlfa('', 236)                        // 062-297: Campos beneficiário (vazio)
      t3 += padAlfa('', 97)                         // 298-394: Branco
      t3 += padNum(seqRegistro, 6)                  // 395-400: Seq. registro
      lines.push(t3)
    }
  }

  // ====== TRAILER (tipo 9) ======
  seqRegistro++
  let tr = ''
  tr += '9'                                         // 001: Tipo registro
  tr += padNum(boletos.length, 6)                   // 002-007: Qtd boletos
  tr += padAlfa('', 387)                            // 008-394: Branco
  tr += padNum(seqRegistro, 6)                      // 395-400: Seq. registro
  lines.push(tr)

  const conteudo = lines.join('\r\n') + '\r\n'
  const nomeArquivo = `CI400_001_${padNum(sequencialArquivo, 7)}.REM`

  return { conteudo, nomeArquivo }
}

// ====== Parser CNAB 400 Retorno ======

export function parsearRetornoCNAB400(content: string): RetornoBoleto400[] {
  const lines = content.split(/\r?\n/).filter(l => l.length >= 400)
  const result: RetornoBoleto400[] = []

  const OCORRENCIAS: Record<string, { desc: string; status: RetornoBoleto400['status'] }> = {
    '02': { desc: 'Em aberto', status: 'REGISTRADO' },
    '03': { desc: 'Erro', status: 'REJEITADO' },
    '06': { desc: 'Pago', status: 'PAGO' },
    '07': { desc: 'Cancelado', status: 'CANCELADO' },
    '14': { desc: 'Alteração vencimento', status: 'OUTRO' },
    '15': { desc: 'Alteração valor', status: 'OUTRO' },
    '16': { desc: 'Alteração vencimento e valor', status: 'OUTRO' },
  }

  for (const line of lines) {
    const tipoRegistro = line[0]

    // Processar apenas Tipo 1 (transação)
    if (tipoRegistro === '1') {
      const ocorrencia = line.substring(89, 91)
      const info = OCORRENCIAS[ocorrencia] || { desc: `Ocorrência ${ocorrencia}`, status: 'OUTRO' as const }

      result.push({
        nossoNumero: line.substring(107, 118).trim(),
        seuNumero: line.substring(97, 107).trim(),
        dataOcorrencia: parseRetDate(line.substring(91, 97)),
        dataVencimento: parseRetDate(line.substring(118, 124)),
        dataCredito: parseRetDate(line.substring(172, 178)),
        valorTitulo: parseInt(line.substring(124, 137)) || 0,
        valorPago: parseInt(line.substring(159, 172)) || 0,
        nomePagador: line.substring(181, 221).trim(),
        cpfCnpjPagador: line.substring(226, 240).trim(),
        motivoRejeicao: ocorrencia === '03' ? line.substring(240, 380).trim() : '',
        numeroOperacao: line.substring(380, 394).trim(),
        ocorrencia,
        ocorrenciaDescricao: info.desc,
        status: info.status,
      })
    }
  }

  return result
}

function parseRetDate(ddmmaa: string): Date | null {
  if (!ddmmaa || ddmmaa === '000000' || ddmmaa.length < 6) return null
  const d = parseInt(ddmmaa.substring(0, 2))
  const m = parseInt(ddmmaa.substring(2, 4)) - 1
  let y = parseInt(ddmmaa.substring(4, 6))
  y += y < 50 ? 2000 : 1900
  if (isNaN(d) || isNaN(m) || isNaN(y)) return null
  return new Date(y, m, d)
}
