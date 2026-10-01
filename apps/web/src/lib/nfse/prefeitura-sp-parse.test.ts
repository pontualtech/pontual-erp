import { describe, it, expect } from 'vitest'
import { parseStringPromise } from 'xml2js'
import { extrairRetornoNFSe } from './prefeitura-sp'

// Mesmas opções do parsearRespostaSP em prefeitura-sp.ts
async function parse(xml: string) {
  return parseStringPromise(xml, {
    explicitArray: false,
    ignoreAttrs: false,
    tagNameProcessors: [(name: string) => name.replace(/.*:/, '')],
  })
}

describe('extrairRetornoNFSe', () => {
  it('Erro real NÃO pode ser escondido por Alerta (caso 318 + 1651 de 01/10/2026)', async () => {
    const body = await parse(
      `<RetornoEnvioRPS xmlns="http://www.prefeitura.sp.gov.br/nfe">` +
        `<Cabecalho Versao="1"><Sucesso>false</Sucesso></Cabecalho>` +
        `<Alerta><Codigo>1651</Codigo><Descricao>Atenção! O Sistema da NFS-e não faz a restrição de leiaute de emissão.</Descricao></Alerta>` +
        `<Erro><Codigo>318</Codigo><Descricao>Campo Cidade/UF não preenchido (obrigatório para tomador com CNPJ).</Descricao></Erro>` +
        `</RetornoEnvioRPS>`
    )
    const r = extrairRetornoNFSe(body)
    expect(r.sucesso).toBe(false)
    const codigos = r.erros!.map((e) => e.codigo)
    expect(codigos).toContain('318')
    expect(codigos).toContain('1651')
    // O erro real vem PRIMEIRO (é o que a UI destaca)
    expect(codigos[0]).toBe('318')
  })

  it('só Alerta com Sucesso=false continua sendo reportado', async () => {
    const body = await parse(
      `<RetornoEnvioRPS><Cabecalho Versao="1"><Sucesso>false</Sucesso></Cabecalho>` +
        `<Alerta><Codigo>1651</Codigo><Descricao>Aviso qualquer</Descricao></Alerta></RetornoEnvioRPS>`
    )
    const r = extrairRetornoNFSe(body)
    expect(r.sucesso).toBe(false)
    expect(r.erros).toEqual([{ codigo: '1651', mensagem: 'Aviso qualquer' }])
  })

  it('sucesso com ChaveNFeRPS segue funcionando (regressão)', async () => {
    const body = await parse(
      `<RetornoEnvioRPS><Cabecalho Versao="1"><Sucesso>true</Sucesso></Cabecalho>` +
        `<ChaveNFeRPS><ChaveNFe><InscricaoPrestador>61899534</InscricaoPrestador><NumeroNFe>244</NumeroNFe><CodigoVerificacao>ABCD1234</CodigoVerificacao></ChaveNFe></ChaveNFeRPS>` +
        `</RetornoEnvioRPS>`
    )
    const r = extrairRetornoNFSe(body)
    expect(r.sucesso).toBe(true)
    expect(r.numero_nfse).toBe('244')
  })
})
