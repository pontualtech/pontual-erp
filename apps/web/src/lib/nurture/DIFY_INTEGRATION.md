# Dify Integration — Habilitar captura autônoma via bot

Doc de referência pra QUANDO você decidir ativar a captura 100% autônoma via bot Marta/Ana. Hoje (2026-05-22) a captura roda **manual** via atendente no `/api/marketing/nurture/capture-manual`.

## Por que ainda não está autônomo

Modificar prompt Dify em produção é alto-risco (bot Marta tá em produção convertendo OS). Documentação preserva opcionalidade — implementa quando estiver pronto.

## Como ativar (3 passos)

### Passo 1: Atualizar prompt Marta (ou Ana)

Adicionar bloco abaixo no `pre_prompt` via Console API (ver `reference_dify.md` na memória):

```
=== REGRA DE CAPTURA DE LEAD (NURTURE) ===

Quando o cliente RECUSAR explicitamente o orçamento (dizer "muito caro",
"vou pensar", "deixa pra lá", "depois", "não vou abrir agora", etc.):

1. Aceitar a recusa com naturalidade (NÃO insistir).
2. Oferecer conteúdo gratuito:
   "Sem problema, [nome]. Posso te mandar 3 dicas grátis quando a impressora
    voltar a dar sinal de problema? Só preciso do seu email."
3. Se cliente recusar email também, encerrar gentilmente.
4. Se cliente fornecer email:
   - Confirmar formato (tem @ e domínio).
   - Perguntar (UMA ÚNICA VEZ): "Você tem notebook em casa/empresa também?
     Às vezes a gente consegue cuidar dos dois."
   - Chamar tool `nurture_capture` (definido abaixo) com email + phone +
     equipments_interest (printer + notebook se sim).
   - Confirmar: "Pronto, [nome]! Mando dicas de vez em quando. Sem spam."
5. Se cliente NÃO fornecer email após 2 tentativas, encerrar.

NÃO mencionar desconto/oferta nessa conversa — só conteúdo. Vendas vem depois.
```

### Passo 2: Configurar tool `nurture_capture` no Dify

No Dify console → App Marta → Tools → Add Custom Tool:

```json
{
  "name": "nurture_capture",
  "description": "Captura lead pós-recusa de orçamento pra nurture perpétua",
  "parameters": {
    "type": "object",
    "properties": {
      "email": { "type": "string", "description": "Email do cliente" },
      "phone": { "type": "string", "description": "WhatsApp do cliente (com DDI)" },
      "name": { "type": "string", "description": "Primeiro nome" },
      "equipments_interest": {
        "type": "array",
        "items": { "type": "string", "enum": ["printer", "notebook"] }
      },
      "refused_quote_id": { "type": "string" }
    },
    "required": ["email"]
  },
  "webhook": {
    "url": "https://erp.pontualtech.work/api/internal/nurture/capture",
    "method": "POST",
    "headers": {
      "X-Internal-Key": "{{env.INTERNAL_API_KEY}}",
      "Content-Type": "application/json"
    },
    "body_template": {
      "company_id": "pontualtech-001",
      "email": "{{email}}",
      "phone": "{{phone}}",
      "name": "{{name}}",
      "journey_type": "recused_os",
      "source_data": {
        "bot_session_id": "{{conversation_id}}",
        "refused_quote_id": "{{refused_quote_id}}",
        "equipments_interest": "{{equipments_interest}}",
        "captured_via": "dify_bot"
      }
    }
  }
}
```

### Passo 3: Smoke test

```bash
# Antes de ativar pra todos, force-direct 1 conversa:
curl -X POST https://erp.pontualtech.work/api/internal/nurture/capture \
  -H "X-Internal-Key: $INTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "company_id": "pontualtech-001",
    "email": "smoketest@example.com",
    "phone": "+5511999999999",
    "name": "Teste",
    "journey_type": "recused_os",
    "source_data": { "equipments_interest": ["printer", "notebook"], "captured_via": "smoke" }
  }'
```

Deve retornar `{"data":{"journey_id":"...","contact_id":"...","is_new":true}}`.

## Captura manual hoje (até ativar autônomo)

Atendente que ver recusa de OS no Chatwoot pode disparar via UI/API:

```bash
# Via fetch no front (sessão user logada):
fetch('/api/marketing/nurture/capture-manual', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'cliente@example.com',
    phone: '+5511999999999',
    name: 'João',
    source_data: {
      conversation_id: chatwootConvId,
      equipments_interest: ['printer', 'notebook'],
      notes: 'Cliente falou que vai pensar — capturei pra nutrição'
    }
  })
})
```

## Quando ativar autônomo

Métricas mínimas pra justificar autonomia:
- ≥10 captures manuais bem-sucedidas no dashboard `/marketing/nurture`
- ≥1 reactivation observada (jornada → OS criada)
- Atendentes reportarem que captura manual é trabalhosa OU pulando recusas

Risco da autonomia: bot pode pedir email em contextos errados (cliente que vai voltar a abrir OS depois pode achar prematuro). Mitigação: período de 30d com sample 10% das conversas → comparar conversion vs manual.
