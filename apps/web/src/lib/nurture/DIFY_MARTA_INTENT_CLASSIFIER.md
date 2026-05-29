# Adendo ao Prompt da Marta (Dify) — Classificador de Intent pra Emails

## O que adicionar ao prompt da Marta

Adicione esta regra **no FINAL do prompt da Marta** (ou em seção própria "Classificação de Intent — Email"):

```
## CLASSIFICAÇÃO DE INTENT (somente para emails recebidos via inbox de email)

Quando responder um email do cliente, você DEVE incluir uma tag de
classificação de intent NO FINAL da resposta (após toda a despedida e
assinatura), seguindo as regras:

[INTENT:commercial]  — Use quando o cliente:
  • Pede orçamento/preço de serviço
  • Diz "estou interessado", "quero saber valores", "vocês fazem X?"
  • Pergunta sobre planos, contratos, novos serviços
  • Cliente potencial NOVO sem OS aberta perguntando capacidade
  • Pede informações comerciais (formas de pagamento, garantia)

[INTENT:support]  — Use quando o cliente:
  • Reporta problema com OS existente (atraso, defeito, status)
  • Faz reclamação ou expressa insatisfação
  • Pede ajuda técnica urgente
  • Cobra retorno sobre orçamento ou serviço em andamento
  • Pede cancelamento, devolução ou reembolso

[INTENT:other]  — Use quando o cliente:
  • Manda mensagem genérica (cumprimento, agradecimento)
  • Pergunta dúvida fora do escopo PontualTech
  • Envia documentos sem contexto
  • Qualquer caso ambíguo onde você não tem certeza

## REGRAS IMPORTANTES

1. **SEMPRE coloque a tag NO FINAL** da resposta, em linha separada.
2. **Use exatamente o formato** `[INTENT:commercial]`, `[INTENT:support]` ou
   `[INTENT:other]` — minúsculas, sem espaços, com colchetes.
3. **A tag será REMOVIDA antes de enviar pro cliente** — ele não verá.
4. **Em caso de dúvida**, use `[INTENT:other]` (default seguro).
5. **Esta tag só vale pra canal EMAIL** — em WhatsApp não precisa incluir.

## Exemplo

Cliente envia:
> "Olá, gostaria de saber o valor de manutenção de uma impressora Epson L3250"

Sua resposta:
> "Olá! Tudo bem? 😊
> Como o orçamento depende de avaliação técnica, o ideal é trazer sua
> Epson L3250 numa de nossas unidades [...] Aguardo seu retorno!
>
> Atenciosamente,
> Equipe PontualTech
> [INTENT:commercial]"

Cliente envia:
> "Bom dia, minha OS 60234 está atrasada há 1 semana, quando vão entregar?"

Sua resposta:
> "Bom dia! Lamento muito o atraso. Vou verificar agora a OS 60234 [...]
>
> Equipe PontualTech
> [URGENCIA_ALTA:60234]
> [INTENT:support]"
```

## Por que essa tag importa pro sistema

O sistema usa essa classificação pra:

- **commercial** → contato entra em série de **welcome emails** (apresentação +
  cross-sell + cupom) — leads quentes virando relacionamento
- **support** / **other** → contato apenas é **cadastrado silenciosamente** na
  lista geral (sem disparar emails — respeita LGPD, evita spam pra quem só
  pediu suporte)

## Onde aplicar

- ✅ **Prompt da Marta (PontualTech)** — Inbox Channel::Email PT
- ✅ **Prompt da Cíntia (Imprimitech)** se for replicar a feature — Inbox email IMP
- ❌ NÃO aplicar nos prompts de WhatsApp (Ana, Aline, Vitória) — esses já têm
  outras tags ativas

## Como deployar no Dify

1. Acesse Dify → app "Marta - Suporte Pontualtech"
2. Aba "Orquestrar" → System Prompt
3. Cole o trecho `## CLASSIFICAÇÃO DE INTENT` no final do prompt
4. Salve. Mudança é ativa IMEDIATAMENTE (não precisa redeploy ERP).
5. Teste mandando 1 email pra contato@pontualtech.com.br e verifique se a tag
   aparece nos logs do bot route (`[Bot/EmailIntent]` confirma captura).

## Backup recomendado

Antes de colar:
1. Copie o prompt atual da Marta
2. Salve em `prompt-marta-pre-intent-classifier-2026-05-29.md` (gitignored ok)
3. Cole o novo
4. Se algo der errado, restaura colando o backup

## Risco

Baixo:
- Não muda comportamento principal da Marta (só adiciona uma tag final)
- Tag é removida antes do cliente ver (não vaza no email)
- Se Marta esquecer de incluir a tag, sistema simplesmente não captura — sem
  erro, sem ruído
- Captura tem try/catch silencioso — falha não bloqueia fluxo de email
