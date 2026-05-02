import { describe, it, expect } from 'vitest'
import { redactDoc, redactPhone, redactEmail, redactName, redactCustomer } from './log-redact'

describe('log-redact (N20 helper)', () => {
  describe('redactDoc', () => {
    it('CPF: mantém 4 primeiros + ***', () => {
      expect(redactDoc('12345678901')).toBe('1234***')
    })
    it('CNPJ formatado: extrai dígitos antes', () => {
      expect(redactDoc('12.345.678/0001-99')).toBe('1234***')
    })
    it('null/undefined retorna string vazia', () => {
      expect(redactDoc(null)).toBe('')
      expect(redactDoc(undefined)).toBe('')
      expect(redactDoc('')).toBe('')
    })
    it('doc curto demais retorna ***', () => {
      expect(redactDoc('123')).toBe('***')
    })
  })

  describe('redactPhone', () => {
    it('11 dígitos: DDD + 4 estrelas + últimos 2', () => {
      expect(redactPhone('11987654321')).toBe('11****21')
    })
    it('formatado: extrai dígitos', () => {
      expect(redactPhone('(11) 98765-4321')).toBe('11****21')
    })
    it('null retorna vazio', () => {
      expect(redactPhone(null)).toBe('')
    })
  })

  describe('redactEmail', () => {
    it('email comum: 2 chars + ***@domain', () => {
      expect(redactEmail('joao.silva@gmail.com')).toBe('jo***@gmail.com')
    })
    it('email curto: primeiro char + ***', () => {
      expect(redactEmail('a@b.com')).toBe('a***@b.com')
    })
    it('email sem @: ***', () => {
      expect(redactEmail('invalid')).toBe('***')
    })
  })

  describe('redactName', () => {
    it('nome completo: primeiro + ***', () => {
      expect(redactName('JOAO DA SILVA')).toBe('JOAO ***')
    })
    it('nome único preserva', () => {
      expect(redactName('Joao')).toBe('Joao')
    })
    it('whitespace múltiplo é normalizado', () => {
      expect(redactName('  JOAO   DA   SILVA  ')).toBe('JOAO ***')
    })
  })

  describe('redactCustomer (composto)', () => {
    it('todos os campos preenchidos', () => {
      const c = {
        legal_name: 'JOAO SILVA',
        document_number: '12345678901',
        mobile: '11987654321',
        email: 'joao@gmail.com',
      }
      const result = redactCustomer(c)
      expect(result).toContain('name=JOAO ***')
      expect(result).toContain('doc=1234***')
      expect(result).toContain('phone=11****21')
      expect(result).toContain('email=jo***@gmail.com')
    })
    it('null customer retorna <null>', () => {
      expect(redactCustomer(null)).toBe('<null>')
    })
    it('preferência mobile sobre phone', () => {
      const c = { mobile: '11987654321', phone: '1133334444' }
      expect(redactCustomer(c)).toContain('phone=11****21')
    })
  })
})
