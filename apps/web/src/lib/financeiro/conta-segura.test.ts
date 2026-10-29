import { describe, it, expect } from 'vitest'
import { contaSemSegredos } from './conta-segura'

describe('contaSemSegredos — a API de contas bancárias não devolve credenciais ao navegador (29/10)', () => {
  it('tira api_key e webhook_token do Asaas e deixa só o indicador de configurado', () => {
    const conta = { id: 'a', name: 'ASSAS', provider_config: { provider: 'asaas', api_url: 'https://api.asaas.com/v3', api_key: '$aact_prod_xyz', webhook_token: 'whsec_abc' } }
    expect(contaSemSegredos(conta)).toEqual({
      id: 'a', name: 'ASSAS',
      provider_config: { provider: 'asaas', api_url: 'https://api.asaas.com/v3', api_key_configurado: true, webhook_token_configurado: true },
    })
  })
  it('qualquer campo com key/token/secret/senha/password é escondido', () => {
    expect(contaSemSegredos({ provider_config: { client_secret: 's', access_token: 't', senha: 'x', password: 'p', provider: 'inter' } }).provider_config)
      .toEqual({ provider: 'inter', client_secret_configurado: true, access_token_configurado: true, senha_configurado: true, password_configurado: true })
  })
  it('não altera o objeto original (a rota continua usando a chave no servidor)', () => {
    const conta = { provider_config: { api_key: 'k' } }
    contaSemSegredos(conta)
    expect(conta.provider_config.api_key).toBe('k')
  })
  it('conta sem provider_config (ou vazio) volta igual', () => {
    expect(contaSemSegredos({ id: 'i', provider_config: {} })).toEqual({ id: 'i', provider_config: {} })
    expect(contaSemSegredos({ id: 'i', provider_config: null })).toEqual({ id: 'i', provider_config: null })
  })
})
