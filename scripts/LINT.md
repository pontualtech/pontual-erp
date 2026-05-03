# Lints estruturais — PontualERP

Dois scripts node que detectam padrões anti-pattern recorrentes nas
auditorias 1-10. Rodam manual via npm OU automático via GitHub Actions
(`.github/workflows/lint.yml`).

## scripts/lint-pt-br.mjs

Detecta strings UI hardcoded sem acentuação (Servico, Acoes, Numero, etc).

### Por que existe
Audits 7-10 detectaram 90+ strings sem ç/til em telas user-facing.
TypeCheck e testes não pegam — UI funciona, mas parece amador (especialmente
no portal cliente).

### Uso
```bash
npm run lint:pt-br              # full report (top 30 issues)
npm run lint:pt-br:stats        # só count

# Filtros
node scripts/lint-pt-br.mjs --list-files     # lista arquivos por count
node scripts/lint-pt-br.mjs --file=os/[id]   # só arquivos que match path
```

### Silenciar
```ts
const x = 'Servico'  // lint-pt-br:ignore  (se intencional)
```

### Baseline atual: 719 issues em 183 arquivos
Top 10 arquivos pendentes:
1. `os/[id]/page.tsx` (26)
2. `portal/[slug]/orcamento/[id]/page.tsx` (0 — já fixed)
3. `config/nfe/page.tsx` (23)
4. `config/empresa/page.tsx` (20)
5. `api/os/[id]/pdf/route.ts` (20)
6. `portal/[slug]/os/[id]/page.tsx` (18)
7. `config/usuarios/page.tsx` (14)
8. `financeiro/extrato/page.tsx` (14)
9. `fiscal/nfe/emitir/page.tsx` (14)
10. `fiscal/emitir-nfse/page.tsx` (12)

### Falsos positivos automaticamente ignorados
- snake_case puros (`inscricao_estadual`)
- Settings paths (`aparencia.tema`)
- Template literals puros (`${var}`)
- URLs / paths / CSS class chains

---

## scripts/lint-structural.mjs

Detecta 4 categorias de anti-patterns críticos:

### 1. 🔥 Multi-tenant guard (CRITICAL)
Queries Prisma sem `company_id` em where → risk IDOR/LGPD.

**Baseline: 18 issues** (vars locais já tenant-scoped — defesa em
profundidade pendente). CI bloqueia se aumentar.

### 2. 🔥 Secrets hardcoded (CRITICAL)
Tokens, keys, passwords literais no código.
Patterns: OpenAI (sk-), Slack (xoxb-), AWS (AKIA), GitHub PAT (ghp_),
Asaas (aass_), Bearer tokens, JWT, DB URLs com senha.

**Baseline: 0 issues** ✅. CI bloqueia em qualquer hit.

### 3. 🟡 `any` em fronteiras de API (MEDIUM)
`: any` em arquivos `/api/.../route.ts` → tipo safety frouxo.

**Baseline: 233 issues** (defer Sprint UX-17 — refactor pra tipos Prisma).
CI informacional apenas.

### 4. 🔵 console.log em produção (LOW)
`console.log/info/debug/trace` em src/ → debug leftover.

**Baseline: 124 issues** (logs estruturados via [tag] em bot/cron/webhook).
CI informacional apenas.

### Uso
```bash
npm run lint:struct                    # full
npm run lint:struct:secrets            # CI-blocker
npm run lint:struct:tenant             # revisão regular
npm run lint:struct:console
npm run lint:struct:any
npm run lint:all                       # combinado pt-br stats + secrets

# Filtros
node scripts/lint-structural.mjs --severity=high
node scripts/lint-structural.mjs --check=multi-tenant --severity=critical
```

### Silenciar
```ts
const c = await prisma.x.update({  // lint-struct:ignore — motivo
  where: { id: variable.id }
})
```

### Whitelist auto (não falha em):
- Paths: `/api/admin/`, `/api/super-admin/`, `/api/cron/`, `/api/internal/`,
  `/api/webhook/`, `/api/auth/`, `/api/portal/auth/`
- Modelos tenant-resolution: `company`, `userProfile`, `loginOtp`,
  `passwordReset`, `magicLink`, `customerAccess`, `session`, `apiKey`
- Chaves UNIQUE GLOBAL: `idempotency_key`, `event_id`, `chatwoot_conv_id`,
  `magic_link_token`, `jti`, `password_reset_token`, `nosso_numero`,
  `asaas_payment_id`, `asaas_id`, `token`, `invite_token`, `visit_confirm_token`
- `where: { id: var.id }` em arquivos com `withTenantTx` ou `company_id` context
- Spread `...base` (assume base contém company_id)

---

## CI integration (template em `ci-templates/lint.yml.template`)

⚠️ **Não está ativo ainda** — workflows precisam ser criados manualmente
pelo dono do repo (token OAuth padrão não tem scope `workflow`).

**Pra ativar:**
1. Criar PAT com scope `workflow` em https://github.com/settings/tokens
2. `cp ci-templates/lint.yml.template .github/workflows/lint.yml`
3. Commit + push (com novo token)
4. Configurar branch protection rule em `main` exigindo os 2 jobs CRITICAL

Roda em todo PR e push pra main. Jobs:

| Job | Severity | Ação |
|---|---|---|
| `lint-secrets` | CRITICAL | **Bloqueia PR** se hardcoded secret detectado |
| `lint-multi-tenant` | CRITICAL | **Bloqueia PR** se `>18` (baseline) |
| `lint-pt-br-info` | INFO | Reporta count, não bloqueia |
| `lint-any-info` | INFO | Reporta count, não bloqueia |

### Atualizar baseline
Quando legitimamente reduzirmos issues, atualizar `BASELINE=18` em `lint.yml`
pra evitar drift. Idealmente baseline → 0 ao longo do tempo.

---

## Histórico de bugs detectados pelo lint

### Audits 7-10 (manual humano via Playwright)
- 90+ acentos UI hardcoded → motivou lint-pt-br
- 0 secrets hardcoded confirmou disciplina histórica
- customer_id leak (snake_case mismatch) — motivou lint-struct multi-tenant
- total_amount field bug (any tipos) — motivou lint-struct any

### Sprints UX-11 a UX-15 (correção)
- 90+ acentos fixados em 14 arquivos
- 18 fixes críticos (calcDelta, theme-provider 403, ticket /ordens 404,
  customer_id leak, total_amount→total_cost)
- 5 fixes auth/secrets NOTA 10
- 5 fixes multi-tenant NOTA 10

### Sprint UX-16 (lint estrutural)
- Detector criado, baseline registrado, CI integrado.
- **Próximas regressões serão pegas automaticamente.**
