# WhatsApp Templates — Nurture Recused OS

Specs pra submeter ao Meta Cloud API (Business Manager → WhatsApp Manager → Message Templates).

Cada template precisa **aprovação manual do Meta** (~1-2h tipicamente). Submeter **agora** os 3 abaixo pra estarem aprovados quando o cron começar a precisar deles (D+1, D+7, D+45 após captura).

> **Regra Meta (descoberta em 2026-05-24):** o body NÃO pode começar nem terminar com uma variável `{{N}}`. Sempre prefixar com uma saudação literal ("Oi {{1}}", "Olá {{1}}" etc). Submissão direta com `{{1}},...` retorna HTTP 400 `error_subcode=2388299`.

## Status atual (2026-05-24)

Os 3 templates abaixo já foram submetidos pra WABA PontualTech (`1325161376335474`) e estão em **PENDING** aguardando review Meta:

| Template | Categoria | Meta ID |
|---|---|---|
| `nurture_d1_empathy` | UTILITY | 2370258016814412 |
| `nurture_d7_checkin` | UTILITY | 1464414781592508 |
| `nurture_d45_pesquisa` | MARKETING | 1133401688997352 |

Verificar status via: `curl "https://graph.facebook.com/v21.0/{waba}/message_templates?access_token={token}" | jq '.data[] | select(.name | startswith("nurture_"))'`

---

## 1. `nurture_d1_empathy` (D+1 após captura — Recomendado UTILITY)

### Categoria
**UTILITY** — passa aprovação mais fácil. Não é promocional.

### Linguagem
Português (Brasil) — `pt_BR`

### Body
```
Oi, {{1}}! Aqui é da PontualTech.

Sem pressão sobre o orçamento — só queria deixar registrado que estamos por aqui caso a impressora volte a dar problema.

Se aparecer qualquer sintoma novo, é só responder essa conversa. Diagnóstico continua sem custo pra você.

Abraço,
Equipe PontualTech
```

### Variables
- `{{1}}` = primeiro nome do cliente (ex: "Maria")

### Buttons
*(Opcional — pode submeter sem buttons primeiro, é mais fácil aprovação)*
- **Quick Reply 1:** "Tenho um problema"
- **Quick Reply 2:** "Tá tudo bem"

---

## 2. `nurture_d7_checkin` (D+7 após captura — Recomendado UTILITY)

### Categoria
**UTILITY**

### Linguagem
`pt_BR`

### Body
```
Oi {{1}}, tudo bem por aí?

Faz uma semana desde nossa última conversa. Só uma checagem rápida: a impressora ainda está dando aquele sintoma ou já voltou ao normal?

Se aparecer qualquer coisa nova, manda foto pra cá. Sem compromisso.

Equipe PontualTech
```

### Variables
- `{{1}}` = primeiro nome

### Buttons (opcional)
- **Quick Reply 1:** "Voltei a ter problema"
- **Quick Reply 2:** "Resolvi por outro lado"

---

## 3. `nurture_d45_pesquisa` (D+45 — MARKETING, pode ser rejeitado)

### Categoria
**MARKETING** — pesquisa de mercado tende a ser MARKETING. Se Meta rejeitar, retentar como UTILITY com texto mais neutro.

### Linguagem
`pt_BR`

### Body
```
Olá {{1}}, posso te pedir 30 segundos?

Faz um mês e meio que você considerou nosso serviço e acabou não fechando. Sem cobrança nenhuma — só queria entender o que pesou na decisão pra gente melhorar.

Foi preço, prazo, distância, ou outra coisa? Responde aí com 1 palavra que ajuda muito.

PontualTech
```

### Variables
- `{{1}}` = primeiro nome

### Buttons (opcional, recomendado)
- **Quick Reply 1:** "Preço"
- **Quick Reply 2:** "Prazo"
- **Quick Reply 3:** "Outro motivo"

---

## Como submeter (passo a passo)

1. Acessar [business.facebook.com](https://business.facebook.com) → WhatsApp Manager
2. Selecionar a conta WhatsApp Business (channel `vendas` — phone_number_id `3136...`)
3. Message Templates → "Create Template"
4. Preencher:
   - **Name:** exatamente como acima (snake_case, sem espaço)
   - **Category:** Marketing/Utility conforme indicado
   - **Language:** Portuguese (BR)
5. Body → colar texto, marcar `{{1}}` como variable
6. (Opcional) Buttons → adicionar quick replies
7. Submit for review

## Verificação pós-aprovação

```bash
# Listar templates aprovados na sua WABA:
curl "https://graph.facebook.com/v21.0/{{waba_id}}/message_templates?access_token={{access_token}}" | jq '.data[] | select(.name | startswith("nurture_"))'
```

Você deve ver 3 entries com `status: "APPROVED"`.

## Variables no código

O `sender.ts` já envia `components` com `{{1}}` = first name extraído de `contact.name`:

```typescript
const components = [
  {
    type: 'body',
    parameters: [{ type: 'text', text: firstName }],
  },
]
```

Se você adicionar buttons quick reply, o webhook do bot já trata respostas. Pode adicionar handlers específicos pra "Voltei a ter problema" → criar ticket / abrir conversa direto.

## Quando ainda não aprovados

Se o cron tentar disparar um template antes da aprovação, o `sendWhatsAppTemplateMetaOnly` retorna `success: false, error: 'template_not_approved'` (ou similar). O cron marca `failed` no log mas **não trava nem reenvia automático** — o lead permanece ativo, e quando o template for aprovado, no próximo tick o disparo acontece.

Vale rodar `?dry_run=1` no cron primeiro pra ver quantos teriam falhado por template:

```bash
curl -X POST "https://erp.pontualtech.work/api/internal/cron/nurture-tick?dry_run=1" \
  -H "x-internal-key: $INTERNAL_API_KEY"
```
