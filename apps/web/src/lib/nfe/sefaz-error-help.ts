// Dicionário SEFAZ → português humano + sugestão de ação.
// Cobre os erros mais comuns observados em emissão NF-e mod 55.
// Quando bater o motivo SEFAZ contra uma key (substring case-insensitive),
// retorna explicação + sugestão. Caso contrário, devolve fallback genérico.

export interface SefazErrorHelp {
  matches: RegExp
  /** O que o erro significa em português comum */
  explanation: string
  /** Onde o usuário deve clicar/editar pra corrigir */
  suggestion: string
}

const ERRORS: SefazErrorHelp[] = [
  {
    matches: /sem informa.{0,5}o da IE do destinat/i,
    explanation: 'O destinatário foi marcado como contribuinte de ICMS, mas o cadastro dele está sem a Inscrição Estadual (IE).',
    suggestion: 'Vá em Clientes, abra o cadastro do destinatário e preencha o campo IE. Se for isento, mude indicador de IE pra "Isento".',
  },
  {
    matches: /Falha no Schema XML/i,
    explanation: 'O XML enviado pra SEFAZ não bate com o formato esperado (faltou campo obrigatório ou tem campo inválido).',
    suggestion: 'Geralmente é bug técnico. Tente corrigir + reemitir. Se persistir, anote o número da nota e avise o suporte.',
  },
  {
    matches: /Informado indevidamente campo valor de pagamento/i,
    explanation: 'A combinação de tipo de pagamento + valor não bate com a regra da SEFAZ-SP. Em operações sem pagamento (remessa/retorno/devolução), o valor deve ser exatamente R$ 0,00.',
    suggestion: 'Verifique se o tipo de operação está correto. Sem pagamento real, marque como "Sem pagamento" e deixe valor zerado.',
  },
  {
    matches: /NCM\s+(?:inexistente|inv.lido)/i,
    explanation: 'O código NCM informado no item não existe na tabela oficial da Receita Federal.',
    suggestion: 'Vá no item da nota e corrija o NCM. Consulte tabela em https://www4.receita.fazenda.gov.br/simulador/PesquisarNCM.jsp.',
  },
  {
    matches: /CFOP\s+(?:inv.lido|inexistente|incompat)/i,
    explanation: 'O CFOP (código de operação fiscal) informado não é válido pra essa combinação de origem/destino ou natureza da operação.',
    suggestion: 'Volte ao passo "Tipo de operação" e confira se a operação selecionada bate com o CFOP usado nos itens.',
  },
  {
    matches: /chave de acesso.+duplicid|nfe j. emitida/i,
    explanation: 'Já existe uma NF-e com essa mesma chave de acesso na SEFAZ. Provavelmente foi emitida antes e o sistema tentou reenviar.',
    suggestion: 'Procure essa nota na lista (Fiscal > NF-e) — ela já existe. Não emita de novo.',
  },
  {
    matches: /Rejei.{0,5}o:.*(?:CNPJ|CPF).+(?:inv.lido|incorret)/i,
    explanation: 'O CNPJ/CPF do emitente ou destinatário está com dígito errado ou formato inválido.',
    suggestion: 'Confira o documento no cadastro de Clientes ou nas configurações fiscais da empresa.',
  },
  {
    matches: /digito verificador|cDV inv.lido/i,
    explanation: 'O dígito verificador da chave de acesso da NF-e não bate. Pode ser bug no gerador do nosso lado.',
    suggestion: 'Reemita a NF-e. Se persistir, anote o número e avise o suporte.',
  },
  {
    matches: /certificado.+(?:vencido|expirado)/i,
    explanation: 'O certificado digital A1 da empresa está expirado.',
    suggestion: 'Vá em Configurações > Fiscal e instale um certificado A1 novo (não vencido).',
  },
  {
    matches: /cMun.+inv.lido|c.digo de munic.pio/i,
    explanation: 'O código IBGE do município do emitente ou destinatário está incorreto ou ausente.',
    suggestion: 'Edite o cadastro do cliente em Clientes e preencha o "Código do município" (7 dígitos IBGE).',
  },
  {
    matches: /endere.o.+(?:obrigat|inv.lido)/i,
    explanation: 'Algum campo de endereço (rua, número, bairro, CEP) está faltando ou inválido.',
    suggestion: 'Abra o cadastro do destinatário em Clientes e complete o endereço.',
  },
  {
    matches: /lote em duplicidade|lote.+j. recebido/i,
    explanation: 'O lote foi enviado duas vezes seguidas pra SEFAZ. Provavelmente a primeira tentativa já passou.',
    suggestion: 'Aguarde 1-2 minutos e verifique se a NF aparece na lista como Autorizada antes de reenviar.',
  },
]

/**
 * Retorna ajuda humanizada pra mensagem de erro vinda da SEFAZ.
 * Se nenhum padrão bater, devolve fallback genérico — Karlão pode ajustar
 * adicionando entradas no array ERRORS conforme novos erros aparecerem.
 */
export function explainSefazError(rawMessage: string | null | undefined): {
  explanation: string
  suggestion: string
} {
  const msg = (rawMessage || '').trim()
  if (!msg) {
    return {
      explanation: 'A SEFAZ rejeitou a NF-e sem detalhar o motivo.',
      suggestion: 'Tente reemitir. Se persistir, anote o número da nota e avise o suporte.',
    }
  }
  for (const entry of ERRORS) {
    if (entry.matches.test(msg)) {
      return { explanation: entry.explanation, suggestion: entry.suggestion }
    }
  }
  return {
    explanation: 'A SEFAZ rejeitou a NF-e com um motivo que ainda não temos tradução automática.',
    suggestion: 'Leia o motivo técnico acima e tente corrigir o ponto indicado. Se não souber o que mudar, anote o número da nota e avise o suporte.',
  }
}
