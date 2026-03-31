/**
 * Gerador de arquivo de remessa CNAB 240 — Banco Inter (077)
 *
 * Padrão: Febraban CNAB 240 posicional (240 caracteres por linha)
 * Uso: Gerar arquivo .rem para upload no Internet Banking do Inter
 *
 * Estrutura:
 * - Header de arquivo (1 registro)
 * - Header de lote (1 registro)
 * - Detalhes segmento P (1 por boleto — dados do título)
 * - Detalhes segmento Q (1 por boleto — dados do sacado)
 * - Trailer de lote (1 registro)
 * - Trailer de arquivo (1 registro)
 */

// ====== Tipos ======

export interface BoletoRemessa {
  nossoNumero: string           // Nosso número (até 15 dígitos)
  seuNumero: string             // Seu número / ID interno
  dataVencimento: Date
  valorNominal: number          // em centavos
  dataEmissao: Date
  // Sacado (pagador)
  sacadoNome: string
  sacadoDocumento: string       // CPF ou CNPJ (só números)
  sacadoEndereco: string
  sacadoBairro: string
  sacadoCidade: string
  sacadoUF: string
  sacadoCEP: string
  // Opcionais
  multa?: number                // percentual (ex: 2.00)
  juros?: number                // percentual mensal (ex: 1.00)
  desconto?: number             // em centavos
  instrucao1?: string
  instrucao2?: string
}

export interface CedenteConfig {
  cnpj: string                  // CNPJ da empresa (só números)
  razaoSocial: string
  agencia: string               // com dígito
  conta: string                 // com dígito
  convenio: string              // código do convênio/beneficiário Inter
  carteira: string              // "112" para Inter cobrança registrada
}

export interface RetornoBoleto {
  nossoNumero: string
  seuNumero: string
  dataCredito: Date | null
  valorPago: number             // em centavos
  dataPagamento: Date | null
  ocorrencia: string            // código de ocorrência
  ocorrenciaDescricao: string
  status: 'PAGO' | 'REJEITADO' | 'CANCELADO' | 'REGISTRADO' | 'OUTRO'
}

// ====== Helpers ======

function pad(value: string | number, length: number, char = ' ', side: 'left' | 'right' = 'right'): string {
  const str = String(value)
  if (side === 'left') return str.padStart(length, char)
  return str.padEnd(length, char)
}

function padN(value: string | number, length: number): string {
  return pad(value, length, '0', 'left')
}

function padA(value: string, length: number): string {
  return pad(value.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').substring(0, length), length)
}

function formatDate(date: Date): string {
  const d = date.getDate().toString().padStart(2, '0')
  const m = (date.getMonth() + 1).toString().padStart(2, '0')
  const y = date.getFullYear().toString()
  return d + m + y  // DDMMAAAA
}

function formatDateSMAAAA(date: Date): string {
  const d = date.getDate().toString().padStart(2, '0')
  const m = (date.getMonth() + 1).toString().padStart(2, '0')
  const y = date.getFullYear().toString()
  return d + m + y
}

function limparDoc(doc: string): string {
  return doc.replace(/[.\-\/]/g, '')
}

// ====== Gerador CNAB 240 ======

/**
 * Gerar arquivo de remessa CNAB 240 para Banco Inter
 *
 * @returns string com o conteúdo do arquivo .rem (cada linha tem 240 chars + \r\n)
 */
export function gerarRemessaCNAB240(
  cedente: CedenteConfig,
  boletos: BoletoRemessa[],
  sequencialArquivo: number = 1
): string {
  const lines: string[] = []
  const now = new Date()
  const cnpjLimpo = limparDoc(cedente.cnpj)
  const agencia = cedente.agencia.replace(/\D/g, '').substring(0, 4)
  const agenciaDV = cedente.agencia.replace(/\D/g, '').substring(4, 5) || '0'
  const conta = cedente.conta.replace(/\D/g, '').substring(0, 12)
  const contaDV = cedente.conta.replace(/[^0-9X]/gi, '').slice(-1) || '0'

  // ====== HEADER DE ARQUIVO (Registro 0) ======
  let h = ''
  h += '077'                        // 001-003: Código do banco (Inter = 077)
  h += '0000'                       // 004-007: Lote de serviço (0000 = header arquivo)
  h += '0'                          // 008: Tipo de registro (0 = header arquivo)
  h += padA('', 9)                  // 009-017: Uso exclusivo FEBRABAN
  h += '2'                          // 018: Tipo inscrição empresa (2 = CNPJ)
  h += padN(cnpjLimpo, 14)         // 019-032: CNPJ
  h += padA(cedente.convenio, 20)   // 033-052: Código do convênio
  h += padN(agencia, 5)            // 053-057: Agência
  h += padA(agenciaDV, 1)          // 058: Dígito agência
  h += padN(conta, 12)             // 059-070: Conta
  h += padA(contaDV, 1)            // 071: Dígito conta
  h += ' '                          // 072: Dígito agência/conta
  h += padA(cedente.razaoSocial, 30)  // 073-102: Nome da empresa
  h += padA('BANCO INTER', 30)     // 103-132: Nome do banco
  h += padA('', 10)                // 133-142: Uso exclusivo FEBRABAN
  h += '1'                          // 143: Código remessa (1 = remessa)
  h += formatDate(now)              // 144-151: Data geração (DDMMAAAA)
  h += padN(now.getHours(), 2) + padN(now.getMinutes(), 2) + padN(now.getSeconds(), 2) // 152-157: Hora
  h += padN(sequencialArquivo, 6)   // 158-163: Sequencial do arquivo
  h += '087'                        // 164-166: Versão do layout (087)
  h += padN(0, 5)                   // 167-171: Densidade gravação
  h += padA('', 20)                // 172-191: Reservado banco
  h += padA('', 20)                // 192-211: Reservado empresa
  h += padA('', 29)                // 212-240: Uso exclusivo FEBRABAN
  lines.push(h)

  // ====== HEADER DE LOTE (Registro 1) ======
  let hl = ''
  hl += '077'                       // 001-003: Código do banco
  hl += '0001'                      // 004-007: Lote de serviço
  hl += '1'                         // 008: Tipo de registro (1 = header lote)
  hl += 'R'                         // 009: Tipo operação (R = remessa)
  hl += '01'                        // 010-011: Tipo serviço (01 = cobrança)
  hl += '00'                        // 012-013: Forma lançamento
  hl += '042'                       // 014-016: Versão layout lote
  hl += ' '                         // 017: Uso exclusivo FEBRABAN
  hl += '2'                         // 018: Tipo inscrição empresa
  hl += padN(cnpjLimpo, 15)        // 019-033: CNPJ
  hl += padA(cedente.convenio, 20)  // 034-053: Código do convênio
  hl += padN(agencia, 5)           // 054-058: Agência
  hl += padA(agenciaDV, 1)         // 059: Dígito agência
  hl += padN(conta, 12)            // 060-071: Conta
  hl += padA(contaDV, 1)           // 072: Dígito conta
  hl += ' '                         // 073: Dígito agência/conta
  hl += padA(cedente.razaoSocial, 30) // 074-103: Nome empresa
  hl += padA('', 40)               // 104-143: Mensagem 1
  hl += padA('', 40)               // 144-183: Mensagem 2
  hl += padN(sequencialArquivo, 8)  // 184-191: Número remessa/retorno
  hl += formatDate(now)             // 192-199: Data gravação
  hl += padN(0, 8)                  // 200-207: Data crédito
  hl += padA('', 33)               // 208-240: Uso exclusivo FEBRABAN
  lines.push(hl)

  // ====== DETALHES (Segmentos P e Q para cada boleto) ======
  let seqRegistro = 0

  for (const boleto of boletos) {
    seqRegistro++
    const docSacado = limparDoc(boleto.sacadoDocumento)
    const tipoDocSacado = docSacado.length <= 11 ? '1' : '2' // 1=CPF, 2=CNPJ

    // ------ SEGMENTO P (dados do título) ------
    let p = ''
    p += '077'                        // 001-003: Código do banco
    p += '0001'                       // 004-007: Lote
    p += '3'                          // 008: Tipo registro (3 = detalhe)
    p += padN(seqRegistro, 5)         // 009-013: Seq. registro no lote
    p += 'P'                          // 014: Código segmento
    p += ' '                          // 015: Uso exclusivo FEBRABAN
    p += '01'                         // 016-017: Código movimento (01 = entrada)
    p += padN(agencia, 5)            // 018-022: Agência
    p += padA(agenciaDV, 1)          // 023: Dígito agência
    p += padN(conta, 12)             // 024-035: Conta
    p += padA(contaDV, 1)            // 036: Dígito conta
    p += ' '                          // 037: Dígito agência/conta
    p += padA(boleto.nossoNumero, 20) // 038-057: Nosso número
    p += padN(cedente.carteira || '112', 1) // 058: Código carteira (1 = cobrança simples)
    p += '1'                          // 059: Forma cadastro (1 = com registro)
    p += '1'                          // 060: Tipo documento (1 = tradicional)
    p += '2'                          // 061: Emissão boleto (2 = cliente emite)
    p += '2'                          // 062: Distribuição (2 = cliente distribui)
    p += padA(boleto.seuNumero, 15)   // 063-077: Seu número
    p += formatDate(boleto.dataVencimento) // 078-085: Data vencimento
    p += padN(boleto.valorNominal, 15) // 086-100: Valor nominal (centavos)
    p += padN(0, 5)                   // 101-105: Agência cobradora
    p += ' '                          // 106: Dígito agência cobradora
    p += '02'                         // 107-108: Espécie título (02 = DM)
    p += 'N'                          // 109: Aceite
    p += formatDate(boleto.dataEmissao) // 110-117: Data emissão
    // Juros
    p += boleto.juros ? '1' : '0'     // 118: Código juros (1 = valor dia)
    p += boleto.juros ? formatDate(boleto.dataVencimento) : padN(0, 8) // 119-126: Data juros
    p += padN(boleto.juros ? Math.round((boleto.valorNominal * (boleto.juros / 100)) / 30) : 0, 15) // 127-141: Valor juros/dia
    // Desconto
    p += boleto.desconto ? '1' : '0'  // 142: Código desconto
    p += padN(0, 8)                   // 143-150: Data desconto
    p += padN(boleto.desconto || 0, 15) // 151-165: Valor desconto
    p += padN(0, 15)                  // 166-180: Valor IOF
    p += padN(0, 15)                  // 181-195: Valor abatimento
    p += padA(boleto.seuNumero, 25)   // 196-220: Identificação título
    p += '1'                          // 221: Código protesto (1 = protestar)
    p += padN(30, 2)                  // 222-223: Dias protesto
    p += '1'                          // 224: Código baixa (1 = baixar após dias)
    p += padN(60, 3)                  // 225-227: Dias baixa
    p += '09'                         // 228-229: Código moeda (09 = real)
    p += padN(0, 10)                  // 230-239: Número contrato
    p += ' '                          // 240: Uso exclusivo FEBRABAN
    lines.push(p)

    seqRegistro++

    // ------ SEGMENTO Q (dados do sacado/pagador) ------
    let q = ''
    q += '077'                        // 001-003: Código do banco
    q += '0001'                       // 004-007: Lote
    q += '3'                          // 008: Tipo registro (3 = detalhe)
    q += padN(seqRegistro, 5)         // 009-013: Seq. registro
    q += 'Q'                          // 014: Código segmento
    q += ' '                          // 015: Uso exclusivo FEBRABAN
    q += '01'                         // 016-017: Código movimento (01 = entrada)
    q += tipoDocSacado                // 018: Tipo inscrição sacado
    q += padN(docSacado, 15)          // 019-033: CPF/CNPJ sacado
    q += padA(boleto.sacadoNome, 40)  // 034-073: Nome sacado
    q += padA(boleto.sacadoEndereco, 40) // 074-113: Endereço
    q += padA(boleto.sacadoBairro, 15) // 114-128: Bairro
    q += padN(limparDoc(boleto.sacadoCEP), 8) // 129-136: CEP
    q += padA(boleto.sacadoCidade, 15) // 137-151: Cidade
    q += padA(boleto.sacadoUF, 2)     // 152-153: UF
    // Sacador/avalista
    q += '0'                          // 154: Tipo inscrição sacador
    q += padN(0, 15)                  // 155-169: CPF/CNPJ sacador
    q += padA('', 40)                // 170-209: Nome sacador
    q += padN(0, 3)                   // 210-212: Banco correspondente
    q += padA('', 20)                // 213-232: Nosso número banco correspondente
    q += padA('', 8)                 // 233-240: Uso exclusivo FEBRABAN
    lines.push(q)
  }

  // ====== TRAILER DE LOTE (Registro 5) ======
  let tl = ''
  tl += '077'                        // 001-003: Código do banco
  tl += '0001'                       // 004-007: Lote
  tl += '5'                          // 008: Tipo registro (5 = trailer lote)
  tl += padA('', 9)                  // 009-017: Uso exclusivo FEBRABAN
  tl += padN(seqRegistro + 2, 6)     // 018-023: Qtd registros no lote (header + detalhes + trailer)
  tl += padN(0, 6)                   // 024-029: Qtd títulos cobrança simples
  tl += padN(0, 17)                  // 030-046: Valor títulos cobrança simples
  tl += padN(0, 6)                   // 047-052: Qtd títulos cobrança vinculada
  tl += padN(0, 17)                  // 053-069: Valor títulos vinculada
  tl += padN(0, 6)                   // 070-075: Qtd títulos cobrança caucionada
  tl += padN(0, 17)                  // 076-092: Valor caucionada
  tl += padN(0, 6)                   // 093-098: Qtd títulos cobrança descontada
  tl += padN(0, 17)                  // 099-115: Valor descontada
  tl += padA('', 8)                  // 116-123: Número aviso lançamento
  tl += padA('', 117)               // 124-240: Uso exclusivo FEBRABAN
  lines.push(tl)

  // ====== TRAILER DE ARQUIVO (Registro 9) ======
  let ta = ''
  ta += '077'                        // 001-003: Código do banco
  ta += '9999'                       // 004-007: Lote (9999 = trailer arquivo)
  ta += '9'                          // 008: Tipo registro (9 = trailer arquivo)
  ta += padA('', 9)                  // 009-017: Uso exclusivo FEBRABAN
  ta += padN(1, 6)                   // 018-023: Qtd lotes
  ta += padN(seqRegistro + 4, 6)     // 024-029: Qtd registros total
  ta += padN(0, 6)                   // 030-035: Qtd contas conciliação
  ta += padA('', 205)               // 036-240: Uso exclusivo FEBRABAN
  lines.push(ta)

  return lines.map(l => l.padEnd(240)).join('\r\n') + '\r\n'
}

// ====== Parser CNAB 240 Retorno ======

/**
 * Parsear arquivo de retorno CNAB 240 do Banco Inter
 *
 * @param content Conteúdo do arquivo .ret
 * @returns Array de boletos com status atualizado
 */
export function parsearRetornoCNAB240(content: string): RetornoBoleto[] {
  const lines = content.split(/\r?\n/).filter(l => l.length >= 240)
  const result: RetornoBoleto[] = []

  const OCORRENCIAS: Record<string, { descricao: string; status: RetornoBoleto['status'] }> = {
    '02': { descricao: 'Entrada confirmada', status: 'REGISTRADO' },
    '03': { descricao: 'Entrada rejeitada', status: 'REJEITADO' },
    '06': { descricao: 'Liquidação normal', status: 'PAGO' },
    '09': { descricao: 'Baixa', status: 'CANCELADO' },
    '17': { descricao: 'Liquidação após baixa', status: 'PAGO' },
    '20': { descricao: 'Confirmação recebimento instrução', status: 'OUTRO' },
  }

  for (const line of lines) {
    const tipoRegistro = line[7]
    const segmento = line[13]

    // Processar apenas segmento T (retorno de títulos)
    if (tipoRegistro === '3' && segmento === 'T') {
      const codOcorrencia = line.substring(15, 17)
      const nossoNumero = line.substring(37, 57).trim()
      const seuNumero = line.substring(58, 73).trim()
      const dataCredito = line.substring(145, 153)
      const valorPago = parseInt(line.substring(81, 96)) || 0

      const ocorrenciaInfo = OCORRENCIAS[codOcorrencia] || { descricao: `Ocorrência ${codOcorrencia}`, status: 'OUTRO' as const }

      result.push({
        nossoNumero,
        seuNumero,
        dataCredito: dataCredito !== '00000000' ? parseReturnDate(dataCredito) : null,
        valorPago,
        dataPagamento: null, // vem do segmento U
        ocorrencia: codOcorrencia,
        ocorrenciaDescricao: ocorrenciaInfo.descricao,
        status: ocorrenciaInfo.status,
      })
    }

    // Segmento U complementa com data de pagamento
    if (tipoRegistro === '3' && segmento === 'U') {
      const dataPag = line.substring(137, 145)
      const last = result[result.length - 1]
      if (last && dataPag !== '00000000') {
        last.dataPagamento = parseReturnDate(dataPag)
      }
    }
  }

  return result
}

function parseReturnDate(ddmmaaaa: string): Date | null {
  if (!ddmmaaaa || ddmmaaaa.length < 8) return null
  const d = parseInt(ddmmaaaa.substring(0, 2))
  const m = parseInt(ddmmaaaa.substring(2, 4)) - 1
  const y = parseInt(ddmmaaaa.substring(4, 8))
  if (isNaN(d) || isNaN(m) || isNaN(y)) return null
  return new Date(y, m, d)
}
