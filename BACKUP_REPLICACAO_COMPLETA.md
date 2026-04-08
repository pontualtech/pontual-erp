# PontualERP - Backup Completo e Guia de Replicacao
## Documento para replicar o sistema em todas as suas funcoes

**Data:** 03/04/2026
**Versao:** v4.2-stable (commit 51610f7)
**URL Producao:** https://erp.pontualtech.work

---

## 1. REPOSITORIO GIT

```
URL: https://github.com/pontualtech/pontual-erp.git
Branch: main
Ultimo commit: 51610f7
Tags: v1.0-stable, v2.0-stable, v3.0-stable, v4.0-stable, v4.1-stable, v4.2-stable
```

### Clonar:
```bash
git clone https://github.com/pontualtech/pontual-erp.git
cd pontual-erp
npm ci
```

---

## 2. STACK TECNOLOGICA

| Componente | Tecnologia | Versao |
|-----------|-----------|--------|
| Frontend | Next.js (App Router) | 14.x |
| Backend | Node.js | 20 (Alpine) |
| ORM | Prisma | 5.22.0 |
| Database | PostgreSQL (Supabase self-hosted) | 15.x |
| Auth | Supabase Auth (cookies httpOnly) | Self-hosted |
| Deploy | Coolify (Docker) | Via Hetzner VPS |
| Email | Resend | API |
| WhatsApp | Chatwoot | Self-hosted |
| Fiscal | Focus NFe (NFS-e) + SEFAZ direto (NF-e) | Producao |
| Bancario | Inter (CNAB 400) | Em configuracao |

---

## 3. INFRAESTRUTURA

### VPS Hetzner
```
IP: 37.27.42.114
OS: Ubuntu (Coolify managed)
Painel Coolify: https://painel.pontualtech.work
Login Coolify: karlao@outlook.com / Lustos@22
API Token Coolify: 1|xkVuvO7NosOuwdp7KXegZjNQI5dWq9wXVu69G9YZe12fe575
App UUID Coolify: vk8csgs0kssc0sokooo00wcc
```

### Supabase Self-Hosted
```
URL API: https://supa-api.pontualtech.work
DB Host: 37.27.42.114
DB Port: 5433
DB Name: postgres
DB User: supabase_admin
DB Password: 7Xn0JMMiz8oLWbCevXF2Ol7bgTvzMkY5

JWT Secret (anon): eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc3MTYyODk0MCwiZXhwIjo0OTI3MzAyNTQwLCJyb2xlIjoiYW5vbiJ9.kRC0MsbmGiSQG2vadREsyynT29yLkHbgbK8-3_DZUuc
JWT Secret (service_role): eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc3MTYyODk0MCwiZXhwIjo0OTI3MzAyNTQwLCJyb2xlIjoic2VydmljZV9yb2xlIn0.L1bDphlsYbsqQeKUfO7SSBDKhu2WahqinKdlOuk_XMc
```

### Dominios
```
erp.pontualtech.work       -> PontualERP (Next.js)
supa-api.pontualtech.work  -> Supabase API (Kong)
chat.pontualtech.work      -> Chatwoot
painel.pontualtech.work    -> Coolify
```

---

## 4. VARIAVEIS DE AMBIENTE (PRODUCAO)

Criar arquivo `.env.production` com:

```env
# === Supabase ===
NEXT_PUBLIC_SUPABASE_URL="https://supa-api.pontualtech.work"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc3MTYyODk0MCwiZXhwIjo0OTI3MzAyNTQwLCJyb2xlIjoiYW5vbiJ9.kRC0MsbmGiSQG2vadREsyynT29yLkHbgbK8-3_DZUuc"
SUPABASE_SERVICE_ROLE_KEY="eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc3MTYyODk0MCwiZXhwIjo0OTI3MzAyNTQwLCJyb2xlIjoic2VydmljZV9yb2xlIn0.L1bDphlsYbsqQeKUfO7SSBDKhu2WahqinKdlOuk_XMc"

# === Database ===
DATABASE_URL="postgresql://supabase_admin:7Xn0JMMiz8oLWbCevXF2Ol7bgTvzMkY5@37.27.42.114:5433/postgres"
DIRECT_URL="postgresql://supabase_admin:7Xn0JMMiz8oLWbCevXF2Ol7bgTvzMkY5@37.27.42.114:5433/postgres"

# === App ===
NEXT_PUBLIC_APP_URL="https://erp.pontualtech.work"
ENCRYPTION_KEY="a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"
ENCRYPTION_SALT="24a8098aed3d5455a09f2917ef7d61392ca1df19c7d53934387ee544fa35a271"

# === Integracoes ===
VHSYS_ACCESS_TOKEN="ADSVXVNOdAJgVMVRHFafLNUGagYVPQ"
VHSYS_SECRET_TOKEN="57ChnH3avbQcNEygyl9JEdv2JhFXQjm"
RESEND_API_KEY="re_73qHLEsQ_MKWx27KNSCFwS9kJyAAhzXeu"

# === Chatwoot ===
CHATWOOT_URL="https://chat.pontualtech.work"
CHATWOOT_API_TOKEN="QoZkviBZmYqmoiDdKLjuioKE"
CHATWOOT_ACCOUNT_ID="1"
CHATWOOT_WEBHOOK_SECRET="aad31cf34a75b22ab7c8968085e98d294eb5e636f4531aa6a52eab1e92d57625"

# === Fiscal ===
FOCUS_NFE_API_KEY=""
FOCUS_NFE_ENVIRONMENT="homologacao"

# === Bancario ===
INTER_CLIENT_ID=""
INTER_CLIENT_SECRET=""
INTER_CERT_PATH=""
INTER_KEY_PATH=""
BOLETO_WEBHOOK_SECRET="1f98f90dab5c4e7379129a3dde88497e43d3437b71fd1836ecc636ead326a6a1"
```

---

## 5. BANCO DE DADOS

### Estatisticas (03/04/2026)
```
service_orders:       4,621
service_order_items: 14,852
service_order_history: 4,719
customers:            3,697
audit_logs:             471
settings:               122
invoices:                27
products:                13
users:                   11
roles:                    6
tickets:                  4
```

### Schema Prisma
Arquivo: `packages/db/prisma/schema.prisma`
60+ modelos incluindo: ServiceOrder, Customer, Invoice, Product, Contract, LogisticsRoute, NpsSurvey, PriceTable, ChatbotLog, etc.

### Replicar schema:
```bash
cd packages/db
npx prisma db push
```

### Backup do banco:
```bash
pg_dump -h 37.27.42.114 -p 5433 -U supabase_admin -d postgres > backup_pontualerp_$(date +%Y%m%d).sql
```

---

## 6. ROLES E PERMISSOES (RBAC)

| Role | ID | Permissoes |
|------|-----|-----------|
| Admin | role-admin | ALL (bypass) |
| Tecnico | role-tecnico | clientes.view, core.view, dashboard.view, estoque.read, os.edit, os.view |
| Motorista | role-motorista | clientes.view, core.view, dashboard.view, os.view, logistics.view |
| Financeiro | role-financeiro | 20 perms (financeiro, fiscal, os, clientes, tickets, chat, estoque, dashboard, core) |
| Atendente | role-atendente | 17 perms (fiscal, os, clientes, tickets, chat, estoque, dashboard, core) |
| Suporte | 6a443465-... | os.view, clientes.view, clientes.edit, dashboard.view, core.view |

### Usuarios de Producao
| Nome | Email | Role | Senha |
|------|-------|------|-------|
| Karlao | karlao@outlook.com | Admin | (definida pelo usuario) |
| Roberto | roberto@pontualtech.com.br | Admin | (definida pelo usuario) |
| Rogerio | rogerio@pontultech.com.br | Admin | (definida pelo usuario) |
| Rafael | rafael@pontualtech.com.br | Atendente | (definida pelo usuario) |
| Daniela | daniela@pontualtech.com.br | Financeiro | (definida pelo usuario) |
| Robo teste | robo@pontualtech.com.br | Admin | Lustos@22 |

### Usuarios de Teste
| Nome | Email | Role | Senha |
|------|-------|------|-------|
| Teste Tecnico | tecnico@pontualtech.com.br | Tecnico | Teste@123 |
| Teste Motorista | motorista@pontualtech.com.br | Motorista | Teste@123 |
| Teste Atendente | atendente@pontualtech.com.br | Atendente | Teste@123 |
| Teste Financeiro | financeiro@pontualtech.com.br | Financeiro | Teste@123 |

---

## 7. MODULOS IMPLEMENTADOS (13)

| # | Modulo | Rota | Status |
|---|--------|------|--------|
| 1 | Dashboard | / | Funcional (KPIs, graficos, pipeline) |
| 2 | Ordens de Servico | /os | Funcional (2724 OS, kanban, filtros) |
| 3 | Clientes | /clientes | Funcional (filtros PF/PJ, cidade, recorrencia) |
| 4 | Tickets | /tickets | Funcional (4 tickets, prioridade, vinculo OS) |
| 5 | Chat Interno | /chat | Funcional (8 canais, real-time via polling) |
| 6 | WhatsApp/Chatwoot | /integracoes/chatwoot | Funcional (3 caixas, bot IA) |
| 7 | Logistica | /logistica | Funcional (rotas, motorista, paradas) |
| 8 | Contratos | /contratos | Funcional (manutencao preventiva) |
| 9 | Produtos/Estoque | /produtos | Funcional (11 itens, alertas, fornecedores) |
| 10 | Financeiro | /financeiro | Funcional (contas, CNAB, DRE, fluxo caixa) |
| 11 | Fiscal | /fiscal | Funcional (27 NFS-e, NF-e SEFAZ, config) |
| 12 | BI / Relatorios | /relatorios-bi | Funcional (5 abas, CSV export) |
| 13 | Configuracoes | /config | Funcional (20+ opcoes) |

---

## 8. SEGURANCA IMPLEMENTADA

### Security Headers (7/7)
- X-Frame-Options: DENY
- X-Content-Type-Options: nosniff
- HSTS: max-age=63072000; includeSubDomains; preload
- X-XSS-Protection: 1; mode=block
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy: camera=(), microphone=(), geolocation=()
- CSP: 342 chars (base-uri, form-action, worker-src, frame-ancestors none)

### RBAC (3 camadas)
1. API-level: requirePermission() em todos os endpoints
2. UI-level: sidebar dinamica + RouteGuard + botoes condicionais
3. Data-level: filtro "Minhas OS" para tecnico, status entrega para motorista

### Protecoes
- Cookies auth httpOnly + Secure + SameSite
- IDOR protection (users, OS, clientes)
- Input validation (UUID regex, path traversal block)
- Middleware 401 JSON para /api/* sem auth
- Certificado A1 nunca retornado via API
- Logout funcional com invalidacao de sessao
- Rate limiting no login

---

## 9. DEPLOY (Coolify)

### Dockerfile
Localizado na raiz: `Dockerfile` (multi-stage build)
- Stage 1 (deps): npm ci
- Stage 2 (builder): prisma generate + next build
- Stage 3 (runner): standalone output + prisma client

### Deploy via Coolify API:
```bash
# Start (full rebuild)
curl -X POST -H "Authorization: Bearer 1|xkVuvO7NosOuwdp7KXegZjNQI5dWq9wXVu69G9YZe12fe575" \
  "https://painel.pontualtech.work/api/v1/applications/vk8csgs0kssc0sokooo00wcc/start"

# Stop
curl -X POST -H "Authorization: Bearer 1|xkVuvO7NosOuwdp7KXegZjNQI5dWq9wXVu69G9YZe12fe575" \
  "https://painel.pontualtech.work/api/v1/applications/vk8csgs0kssc0sokooo00wcc/stop"
```

### Deploy manual:
```bash
git push origin main
# Coolify auto-deploys ou trigger via API acima
```

---

## 10. REPLICACAO EM NOVO SERVIDOR

### Passo 1: Clonar repositorio
```bash
git clone https://github.com/pontualtech/pontual-erp.git
cd pontual-erp
npm ci
```

### Passo 2: Configurar Supabase
```bash
# Instalar Supabase self-hosted via Docker
# Ou usar supabase.com (cloud)
# Copiar JWT keys para .env
```

### Passo 3: Configurar banco
```bash
# Criar banco PostgreSQL
# Importar backup: psql -h HOST -p PORT -U USER -d DB < backup.sql
# Ou recriar schema: cd packages/db && npx prisma db push
```

### Passo 4: Configurar variaveis de ambiente
```bash
# Copiar .env.production acima
# Ajustar URLs e credenciais para novo servidor
```

### Passo 5: Build e run
```bash
# Local:
npm run build
npm start

# Docker:
docker build -t pontual-erp .
docker run -p 3000:3000 --env-file .env.production pontual-erp

# Coolify:
# Configurar app apontando para o repo Git
# Adicionar env vars via API ou painel
```

### Passo 6: Configurar DNS
```
erp.novaempresa.com      -> IP do servidor
supa-api.novaempresa.com -> IP do Supabase
```

---

## 11. PORTAL DO CLIENTE

```
URL: https://erp.pontualtech.work/portal/pontualtech/login
Auth: CPF/CNPJ + senha (bcrypt hash)
Funcoes: Ver OS, aprovar/recusar orcamento, criar OS, NPS, tickets
```

### Clientes com acesso ao portal:
| Cliente | CPF/CNPJ | Senha |
|---------|----------|-------|
| CARLOS LUSTOSA | 14406779809 | 14406 |
| ALLUGGA EQUIPAMENTOS | 43077253000176 | (hash bcrypt) |

---

## 12. INTEGRACOES EXTERNAS

### Chatwoot (WhatsApp)
```
URL: https://chat.pontualtech.work
API Token: QoZkviBZmYqmoiDdKLjuioKE
Account ID: 1
Webhook: POST /api/chatwoot/webhook
Secret: aad31cf34a75b22ab7c8968085e98d294eb5e636f4531aa6a52eab1e92d57625
```

### VHSys (ERP legado)
```
Access Token: ADSVXVNOdAJgVMVRHFafLNUGagYVPQ
Secret Token: 57ChnH3avbQcNEygyl9JEdv2JhFXQjm
Sync: /api/sync-vhsys (importa OS, clientes, servicos)
```

### Resend (Email)
```
API Key: re_73qHLEsQ_MKWx27KNSCFwS9kJyAAhzXeu
From: contato@pontualtech.com.br
Usado para: orcamentos, notificacoes OS, NPS
```

### Focus NFe (NFS-e)
```
API Key: (configurar em /config quando disponivel)
Ambiente: homologacao (mudar para producao quando pronto)
Prefeitura: SP (Sao Paulo)
```

### Banco Inter (CNAB 400)
```
Client ID: (configurar quando credenciais disponiveis)
Client Secret: (configurar)
Webhook Secret: 1f98f90dab5c4e7379129a3dde88497e43d3437b71fd1836ecc636ead326a6a1
```

---

## 13. CONFIGURACOES DA EMPRESA (Settings)

Dados fiscais configurados no sistema:
```
CNPJ: 32.772.178/0001-47
IE: 126508493111
Razao Social: PONTUAL TECH SERVICOS DE INFORMATICA LTDA
Nome Fantasia: PontualTech
Endereco: Rua Ouvidor Peleja, 660 - Vila Mariana - 04128-001 - Sao Paulo/SP
Telefone: (11) 3136-0415
WhatsApp: (11) 2626-3841
Email: contato@pontualtech.com.br
CRT: 1 (Simples Nacional)
CNAE: 9511800
Codigo Municipio: 3550308
Aliquota ISS: 5.00%
Codigo Servico: 07498
```

### Contas Bancarias
```
Conta Inter: Ag 0001, CC 4025073-3, Convenio 40250733, Carteira 112
ITAU PRINCIPAL: configurada no sistema
STONE: configurada no sistema
```

### Taxas de Cartao (Rede)
```
Debito: 0.79%
Credito 1x: 3.27%
Credito 2x: 4.24%
Credito 3x: 4.91%
... ate 10x: 9.86%
```

---

## 14. AUDITORIA DE SEGURANCA (v13 - Nota A+ 9.7)

```
Endpoints GET testados: 36 x 5 roles = 180 testes
Write endpoints testados: 16 bloqueados
IDOR testados: 6 corretos
Route guards: 9/9 bloqueados
Security headers: 7/7 presentes
Auth sem cookie: 10/10 retornam 401 JSON
Vetores de ataque: 13/14 bloqueados
Total: 252+ testes executados
Criticos: ZERO
Medios: ZERO
Nota: A+ (9.7/10)
```

---

*Documento gerado em 03/04/2026 — Backup completo para replicacao do PontualERP*
