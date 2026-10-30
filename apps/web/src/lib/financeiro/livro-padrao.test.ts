import { describe, it, expect } from 'vitest'
import { padraoDaLinha } from './livro-padrao'

describe('padraoDaLinha', () => {
  const casos: Array<[string, string | null]> = [
    ['PIX ENVIADO ELVIS FERREIRA', 'ELVIS FERREIRA'],
    ['Transação via Pix com chave para ELVIS FERREIRA DE FRANCA', 'ELVIS FERREIRA DE FRANCA'],
    ['Transação via Pix com QR Code para MINISTERIO DA FAZENDA', 'MINISTERIO DA FAZENDA'],
    ['PIX RECEBIDO ROGERIO29/10', 'ROGERIO'],
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
