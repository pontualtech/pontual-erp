/**
 * CEP → código IBGE do município (NFS-e SP, 01/10/2026).
 *
 * Desde a virada de regra da prefeitura (pacote IBS/CBS), o EnderecoTomador
 * com Cidade/UF é obrigatório para tomador CNPJ (erro 318). O cadastro de
 * cliente nem sempre tem cod_municipio preenchido, mas o CEP identifica a
 * capital com segurança: faixas 01000-000–05999-999 e 08000-000–08499-999
 * pertencem exclusivamente ao município de São Paulo (3550308).
 *
 * Fora dessas faixas retorna undefined (o endereço é omitido como antes e,
 * se a prefeitura exigir, o erro 318 orienta preencher cod_municipio no
 * cadastro do cliente).
 */
export function codigoIbgeCapitalSPPorCep(cep: string | null | undefined): string | undefined {
  if (!cep) return undefined
  const digits = cep.replace(/\D/g, '')
  if (digits.length !== 8) return undefined
  const n = parseInt(digits, 10)
  if ((n >= 1000000 && n <= 5999999) || (n >= 8000000 && n <= 8499999)) return '3550308'
  return undefined
}
