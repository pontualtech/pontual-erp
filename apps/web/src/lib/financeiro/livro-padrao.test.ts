import { describe, it, expect } from 'vitest'
import { padraoDaLinha } from './livro-padrao'

describe('padraoDaLinha', () => {
  const casos: Array<[string, string | null]> = [
    ['PIX ENVIADO ELVIS FERREIRA', 'ELVIS FERREIRA'],
    ['Transação via Pix com chave para ELVIS FERREIRA DE FRANCA', 'ELVIS FERREIRA DE FRANCA'],
    ['Transação via Pix com QR Code para MINISTERIO DA FAZENDA', 'MINISTERIO DA FAZENDA'],
    // Itaú trunca o nome do PIX recebido (~7 letras) → regra genérica demais ('ROGERIO', 'JOAO DE').
    ['PIX RECEBIDO ROGERIO29/10', null],
    ['PIX RECEBIDO ARTUS A28/10', null],
    ['PIX RECEBIDO JOAO DE29/10', null],
    ['PIX RECEBIDO M JOSE01/10', null],
    ['PIX QRS CONDOMINIO RESIDENC', null],
    // Asaas: o texto fixo venceria o nome do cliente (já existe a regra explícita 'Cobrança recebida').
    ['Cobrança recebida - fatura nr. 921607930 LAURA MORAES (líquido da taxa)', null],
    ['Cobrança recebida - fatura nr. 932264422 KALUNGA SA (líquido da taxa)', null],
    ['Cobrança recebida - fatura nr. 946509767 GHEE BANQUETERIA SERVICOS DE BUFFET E EVENTOS LTDA (líquido da taxa)', null],
    // Depósito em dinheiro: o padrão cobriria todo depósito.
    ['DEP DIN ATM N. 104245945', null],
    ['Taxa de mensageria - fatura nr. 921607930 LAURA MORAES', 'TAXA DE MENSAGERIA - FATURA NR.'],
    ['PIX ENVIADO', null],
    ['TAR PACOTE 123456', 'TAR PACOTE'],
    ['TED 12345678', null],
    ['PIX ENVIADO JOÃO DA SILVA', 'JOÃO DA SILVA'],
    ['TRANSACAO VIA PIX COM CHAVE PARA FULANO DE TAL', 'FULANO DE TAL'],
    ['Transação via Pix com dados manuais para  MARIA   SOUZA', 'MARIA   SOUZA'],
    ['BOLETO', null],
    ['PIX QRS ABC', null],
  ]

  it.each(casos)('%s -> %s', (texto, esperado) => {
    expect(padraoDaLinha(texto)).toBe(esperado)
  })

  it('invariante: todo resultado não nulo é substring do texto em maiúsculas', () => {
    for (const [texto] of casos) {
      const r = padraoDaLinha(texto)
      if (r !== null) expect(texto.toUpperCase().includes(r)).toBe(true)
    }
  })
})
