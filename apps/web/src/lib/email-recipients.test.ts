import { describe, it, expect } from 'vitest'
import { parseRecipients } from './email-recipients'

describe('parseRecipients', () => {
  it('mantém um endereço só', () => {
    expect(parseRecipients('contato@exemplo.com.br')).toEqual(['contato@exemplo.com.br'])
  })
  it('separa por ponto e vírgula (caso que o Resend recusava)', () => {
    expect(parseRecipients('contato@exemplo.com.br;financeiro@exemplo.com.br')).toEqual(['contato@exemplo.com.br', 'financeiro@exemplo.com.br'])
  })
  it('separa por vírgula e tira espaços e sobras', () => {
    expect(parseRecipients(' a@exemplo.com , b@exemplo.com ; ')).toEqual(['a@exemplo.com', 'b@exemplo.com'])
  })
  it('tira repetidos sem diferenciar maiúsculas', () => {
    expect(parseRecipients('a@exemplo.com;A@EXEMPLO.COM')).toEqual(['a@exemplo.com'])
  })
  it('preserva o formato "Nome <email>"', () => {
    expect(parseRecipients('Loja Exemplo <loja@exemplo.com>')).toEqual(['Loja Exemplo <loja@exemplo.com>'])
  })
  it('vazio vira lista vazia', () => {
    expect(parseRecipients('')).toEqual([])
    expect(parseRecipients(' ; ')).toEqual([])
  })
})
