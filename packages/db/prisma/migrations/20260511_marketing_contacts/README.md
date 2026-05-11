# Marketing Contacts — vocabulário de tags

Tabela `marketing_contacts` é a source-of-truth para todos os contatos elegíveis a email marketing por empresa (multi-tenant via `company_id`). Alimentada automaticamente via triggers ERP (Fase 2) e manualmente via UI (Fase 3).

## Estrutura

- `origin` (text, único valor): de onde veio o contato
- `tags` (text[]): dimensões livres pra segmentação — origem, estágio funil, ano, marca etc.
- `metadata` (jsonb): campos custom por integração (last_os_id, last_amount, score, etc)

## Vocabulário oficial de tags

### Origem (1 tag por contato — sempre em `tags[]` além da coluna `origin`)
- `origin:vhsys_import` — importado do VHSys (base histórica)
- `origin:erp_os` — criado quando OS gerada no ERP
- `origin:erp_quote` — orçamento gerado mesmo sem OS
- `origin:form_site` — preencheu form de contato em algum site PT
- `origin:form_orcamento` — preencheu form de orçamento online
- `origin:manual` — adicionado direto pela equipe via UI
- `origin:indication` — indicação de outro cliente
- `origin:landing_page` — landing específica (campanha paga)
- `origin:lead_quiz` — interagiu com quiz/calculadora

### Estágio do funil
- `stage:lead_cold` — só email, sem interação ainda
- `stage:lead_warm` — abriu ou clicou em algum email
- `stage:opportunity` — pediu orçamento ou solicitou retorno
- `stage:cliente_ativo` — tem OS em andamento ou concluída <12m
- `stage:cliente_atendido` — pelo menos 1 OS PAGA finalizada
- `stage:cliente_recusou` — recusou orçamento
- `stage:cliente_inativo` — última interação >12m
- `stage:inadimplente` — tem AccountReceivable em atraso
- `stage:vip` — tickets pagos >R$X cumulativo (regra a definir)
- `stage:churn` — descadastrou ou marcou spam

### Empresa / segmento comercial
- `segment:b2b` — pessoa jurídica (LTDA, S/A, ME, EIRELI, etc no nome)
- `segment:b2c` — pessoa física
- `segment:cliente_pontualtech` — base PT
- `segment:cliente_imprimitech` — base IMP

### Ano de aquisição (último atendimento)
- `year:2015`, `year:2019`, `year:2020`, ..., `year:2026`

### Tipo de serviço (multi)
- `service:impressora` — atendido pra conserto impressora
- `service:notebook` — atendido pra conserto notebook
- `service:cartucho_toner` — recarga
- `service:plotter`
- `service:multifuncional`

### Comportamento de email
- `email:engaged` — abriu ≥1 nos últimos 30 dias
- `email:bouncing` — soft bounce ≥1
- `email:complained` — marcou como spam

## Convenção

Tags seguem prefixo `dimensao:valor` quando precisam de namespace. Tags livres (sem prefixo) também aceitas pra campanhas pontuais (ex: `black_friday_2026`).

## Triggers planejados (Fase 2)

1. `AFTER INSERT ON service_orders` → upsert `marketing_contacts` com `origin='erp_os'`, tag `stage:cliente_ativo` + `service:<tipo>` + `year:<atual>`
2. `AFTER UPDATE OF status ON service_orders WHEN status='PAGA'` → adicionar tag `stage:cliente_atendido`
3. `AFTER UPDATE OF status ON quotes WHEN status='RECUSADA'` → adicionar tag `stage:cliente_recusou`
4. `AFTER UPDATE OF status ON accounts_receivable WHEN status='VENCIDA'` → adicionar tag `stage:inadimplente`
5. `AFTER INSERT ON customers` → upsert + tag `origin:erp_os` se vinculado a OS, senão `origin:manual`

## Campanha vs Lista

Não usar listas estáticas. Campanhas devem fazer query dinâmica em `marketing_contacts` via `tags`:

```sql
-- Exemplo: clientes atendidos B2C em 2025-2026 que não receberam newsletter notebook ainda
SELECT email, name FROM marketing_contacts
WHERE company_id = $1
  AND 'stage:cliente_atendido' = ANY(tags)
  AND 'segment:b2c' = ANY(tags)
  AND (tags && ARRAY['year:2025','year:2026'])
  AND unsubscribed = false
  AND NOT 'campaign:notebook_2026_05' = ANY(tags);
```

Após disparo: `UPDATE marketing_contacts SET tags = array_append(tags, 'campaign:notebook_2026_05'), last_sent_at = now() WHERE id IN (...);`
