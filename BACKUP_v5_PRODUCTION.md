# PontualERP v5.0 — Backup Completo de Producao
## Documento de Restauracao e Replicacao

**Data:** 07/04/2026
**Tag:** v5.0-production (commit 5ac7c7b)
**URL:** https://erp.pontualtech.work
**Commits:** 302 | **Arquivos:** 370 source files | **Schema:** 1248 linhas

---

## 1. AUDITORIA DE MODULOS (14 modulos)

| # | Modulo | Status | Volume |
|---|--------|:------:|--------|
| 1 | Dashboard | OK | KPIs filtrados por role, graficos, pipeline 14 status |
| 2 | Ordens de Servico | OK | 4.665 OS, 100/pagina, filtros, kanban, overdue |
| 3 | Clientes | OK | 3.733 clientes, filtros PF/PJ/cidade/recorrencia, IE |
| 4 | Tickets | OK | 4 tickets, vinculo OS, atribuicao automatica |
| 5 | Chat Interno | OK | 32 mensagens, 8 canais, alinhamento mensagens |
| 6 | WhatsApp/Chatwoot | OK | 3 caixas, Bot Ana, criacao OS no ERP |
| 7 | Logistica | OK | Rotas, motorista, paradas, coleta/entrega |
| 8 | Contratos | OK | Manutencao preventiva, visitas, equipamentos |
| 9 | Produtos/Estoque | OK | 13 itens, alertas, fornecedores, compras |
| 10 | Financeiro | OK | Contas receber/pagar, CNAB, DRE, fluxo caixa, taxas cartao auto |
| 11 | Fiscal NFS-e | OK | 57 notas, Focus NFe, emissao/cancelamento |
| 12 | Fiscal NF-e | OK | 28 notas, SEFAZ SP direto, DANFE, XML, email, cancelamento |
| 13 | BI / Relatorios | OK | 5 abas + NPS, CSV export, funil, SLA, margem, comissao |
| 14 | Configuracoes | OK | 20+ opcoes, RBAC, certificado A1, contas padrao |

## 2. AUDITORIA RBAC (24 endpoints x 5 roles)

| Endpoint | ADM | ATD | TEC | MOT | FIN |
|----------|:---:|:---:|:---:|:---:|:---:|
| /api/os | 200 | 200 | 200 | 200 | 200 |
| /api/clientes | 200 | 200 | 200 | 200 | 200 |
| /api/users | 200 | 403 | 403 | 403 | 403 |
| /api/roles | 200 | 403 | 403 | 403 | 403 |
| /api/tickets | 200 | 200 | 403 | 403 | 200 |
| /api/settings | 200 | 403 | 403 | 403 | 403 |
| /api/chat | 200 | 200 | 403 | 403 | 200 |
| /api/kits | 200 | 200 | 200 | 403 | 200 |
| /api/price-table | 200 | 200 | 403 | 403 | 200 |
| /api/produtos | 200 | 200 | 200 | 403 | 200 |
| /api/relatorios | 200 | 403 | 403 | 403 | 200 |
| /api/chat/channels | 200 | 200 | 403 | 403 | 200 |
| /api/financeiro/* | 200 | 403 | 403 | 403 | 200 |
| /api/fiscal/nfse | 200 | 200 | 403 | 403 | 200 |
| /api/fiscal/nfe | 200 | 200 | 403 | 403 | 200 |
| /api/fiscal/config | 200 | 403 | 403 | 403 | 200 |

**Sidebar por role:**
- Admin: 13 itens
- Atendente: 8 itens (sem Financeiro, BI, Logistica, Config)
- Tecnico: 4 itens (Dashboard, OS, Clientes, Produtos)
- Motorista: 3 itens (Dashboard, OS, Clientes)
- Financeiro: 10 itens (sem Chat, WhatsApp, Logistica, Config)

## 3. AUDITORIA DE SEGURANCA

| Item | Status |
|------|:------:|
| 7/7 Security Headers (CSP, HSTS, X-Frame, etc.) | OK |
| Certificado A1 nunca exposto via API | OK |
| api_key mascarada | OK |
| Logout funcional (invalida sessao) | OK |
| 401 JSON para /api/* sem auth | OK |
| Cookies auth httpOnly | OK |
| IDOR protection (users, OS, clientes) | OK |
| Route guards (9/9 rotas protegidas) | OK |
| Dashboard filtra faturamento por role | OK |
| OS edit attribution (tecnico so suas) | OK |

## 4. NF-e ESTADUAL (SEFAZ SP)

| Feature | Status |
|---------|:------:|
| Emissao direto SEFAZ SP (sem Focus NFe) | OK — 3 notas autorizadas |
| Certificado A1 upload + validade visual | OK |
| Stepper 4 etapas (cabecalho, itens, transporte, revisao) | OK |
| DANFE print A4 | OK |
| Download XML | OK |
| Email NF-e via Resend | OK |
| Cancelamento | OK (protocolo salvo) |
| CCe (Carta Correcao) | OK |
| Tradutor 30+ rejeicoes SEFAZ | OK |
| Reenviar rejeitadas | OK |
| Importar XML recebidas | OK |
| Ambiente toggle (homologacao/producao) | OK |
| Simples Nacional (CSOSN 102) | OK |

## 5. INFRAESTRUTURA

```
VPS: 37.27.42.114 (Hetzner)
Coolify: painel.pontualtech.work
App: erp.pontualtech.work
Supabase: supa-api.pontualtech.work (self-hosted)
Chatwoot: chat.pontualtech.work
DB: PostgreSQL 5433
```

## 6. VARIAVEIS DE AMBIENTE (PRODUCAO)

```env
NEXT_PUBLIC_SUPABASE_URL="https://supa-api.pontualtech.work"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJ0eXAi...kRC0MsbmGi..."
SUPABASE_SERVICE_ROLE_KEY="eyJ0eXAi...L1bDphlsYb..."
DATABASE_URL="postgresql://supabase_admin:7Xn0JMMiz8oLWbCevXF2Ol7bgTvzMkY5@37.27.42.114:5433/postgres"
DIRECT_URL="postgresql://supabase_admin:7Xn0JMMiz8oLWbCevXF2Ol7bgTvzMkY5@37.27.42.114:5433/postgres"
NEXT_PUBLIC_APP_URL="https://erp.pontualtech.work"
ENCRYPTION_KEY="a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"
ENCRYPTION_SALT="24a8098aed3d5455a09f2917ef7d61392ca1df19c7d53934387ee544fa35a271"
VHSYS_ACCESS_TOKEN="ADSVXVNOdAJgVMVRHFafLNUGagYVPQ"
VHSYS_SECRET_TOKEN="57ChnH3avbQcNEygyl9JEdv2JhFXQjm"
RESEND_API_KEY="re_73qHLEsQ_MKWx27KNSCFwS9kJyAAhzXeu"
CHATWOOT_URL="https://chat.pontualtech.work"
CHATWOOT_API_TOKEN="QoZkviBZmYqmoiDdKLjuioKE"
CHATWOOT_ACCOUNT_ID="1"
CHATWOOT_WEBHOOK_SECRET="aad31cf34a75b22ab7c8968085e98d294eb5e636f4531aa6a52eab1e92d57625"
BOLETO_WEBHOOK_SECRET="1f98f90dab5c4e7379129a3dde88497e43d3437b71fd1836ecc636ead326a6a1"
```

## 7. CREDENCIAIS DE ACESSO

### ERP
| Role | Email | Senha |
|------|-------|-------|
| Admin | robo@pontualtech.com.br | Lustos@22 |
| Tecnico | tecnico@pontualtech.com.br | Teste@123 |
| Motorista | motorista@pontualtech.com.br | Teste@123 |
| Atendente | atendente@pontualtech.com.br | Teste@123 |
| Financeiro | financeiro@pontualtech.com.br | Teste@123 |

### Portal Cliente
| Cliente | CPF | Senha |
|---------|-----|-------|
| CARLOS LUSTOSA | 14406779809 | 14406 |

### Coolify
```
URL: painel.pontualtech.work
Login: karlao@outlook.com / Lustos@22
API Token: 1|xkVuvO7NosOuwdp7KXegZjNQI5dWq9wXVu69G9YZe12fe575
App UUID: vk8csgs0kssc0sokooo00wcc
```

## 8. BANCO DE DADOS

```
OS: 4.665 | Clientes: 3.733 | NF-e: 28 (3 autorizadas)
Usuarios: 12 | Roles: 6 (Admin, Atendente, Financeiro, Tecnico, Motorista, Suporte)
Items OS: 14.860 | Historico: 4.804 | Settings: 139
Schema: 1.248 linhas | 60+ tabelas
```

### Backup do banco:
```bash
pg_dump -h 37.27.42.114 -p 5433 -U supabase_admin -d postgres > backup_v5_$(date +%Y%m%d).sql
```

## 9. RESTAURACAO

### Clonar e instalar:
```bash
git clone https://github.com/pontualtech/pontual-erp.git
cd pontual-erp
git checkout v5.0-production
npm ci
```

### Configurar:
```bash
cp .env.example apps/web/.env
# Editar com as variaveis acima
```

### DB:
```bash
cd packages/db && npx prisma db push
```

### Docker:
```bash
docker build -t pontual-erp .
docker run -p 3000:3000 --env-file .env pontual-erp
```

## 10. EMPRESA

```
PontualTech — Assistencia Tecnica em Informatica
CNPJ: 32.772.178/0001-47 | IE: 126.508.493.111
Rua Ouvidor Peleja, 660 — Vila Mariana — CEP 04128-001 — Sao Paulo/SP
Tel: (11) 3136-0415 | WhatsApp: (11) 2626-3841
Email: contato@pontualtech.com.br | Site: pontualtech.com.br
CRT: 1 (Simples Nacional) | CNAE: 9511800
```

## 11. GIT TAGS

| Tag | Descricao |
|-----|-----------|
| v1.0-stable | Pre-NF-e |
| v2.0-stable | Post-financeiro |
| v3.0-stable | Post-logistica+estoque+IA |
| v4.0-stable | Sprints 1-7 |
| v4.1-stable | Sprint 8 (NPS, portal OS, quotes) |
| v4.2-stable | RBAC completo |
| v4.3-final | RBAC A+ + documentacao |
| v5.0-production | NF-e estadual + SEFAZ SP + DANFE + todos os modulos |

---

*Backup gerado em 07/04/2026 — PontualERP v5.0 Production*
*302 commits | 370 source files | 14 modulos | RBAC A+ | NF-e SEFAZ SP*
