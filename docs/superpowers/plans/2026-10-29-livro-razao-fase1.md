# Livro-razão do banco — Fase 1 (Itaú + Asaas + ajuste de caixa) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A partir do corte (fim de 29/10/2026), toda linha do extrato do Itaú e do Asaas da PT vira exatamente um
lançamento no ERP, com categoria, e o saldo de cada conta no ERP passa a bater com o banco (passado zerado por um
"Ajuste de caixa").

**Architecture:** O ERP ganha (1) categoria e origem no `Transaction`, (2) regras de classificação, (3) três rotas
`/api/financeiro/livro/*` (lançar linhas, ajuste de caixa, classificar) com o núcleo em funções puras testadas. A rotina
da manhã (`rotina/itau/conciliar.cjs`, 07:45) passa a ler também as SAÍDAS, monta as linhas do Itaú e do Asaas com a
chave estável e os vínculos aos créditos que a conciliação de contas a receber já criou, e envia ao ERP.

**Tech Stack:** Next.js 14 + Prisma 5 (Postgres) + vitest no ERP (`C:\dev\pontual-erp`); Node 24 + Playwright/CDP +
`node --test` na rotina (`C:\Users\pontu\Downloads\dia a dia\rotina\itau`).

**Spec:** `docs/superpowers/specs/2026-10-29-financeiro-espelho-do-banco-design.md`

**Próximos planos (fora desta fase):** Plano 2 — cartões (Itaú 5290 pela fatura; Inter pelo site + PDF do Drive para
o 1090) e conta corrente PT↔IMP; Plano 3 — dinheiro em espécie (cobrança diária no grupo ADM, casar depósito) e
conta Inter; Plano 4 — relatórios mensais por categoria e tela de "a classificar".

## Global Constraints

- Bancos só com acesso de consulta; Itaú no Chrome próprio porta 9340, nunca a 9333.
- Nunca importar OFX no ERP.
- Nunca contar o mesmo dinheiro duas vezes: linha do banco que já tem crédito no ERP é LIGADA, não criada de novo.
- Linha que não casa com nada é lançada mesmo assim ("Receita a identificar" / "A classificar") — saldo do ERP = banco.
- Corte = fim de 2026-10-29. Linhas com data ≤ 29/10 nunca são lançadas pelo livro (`data <= '2026-10-29'` → IGNORAR).
- Ajuste de caixa: 1 lançamento por conta, datado 2026-10-29, categoria "Ajuste de caixa", fora do resultado; valor =
  saldo real do fim de 29/10 − saldo do ERP NO MOMENTO da execução (30/10 cedo, depois da conciliação e antes do
  livro). Motivo: a conciliação grava o crédito com a data do clique, não a do banco — um corte por data contaria em
  dobro o dinheiro que caiu antes e foi liquidado depois.
- Asaas: recebimento (PAYMENT_RECEIVED) e taxa (PAYMENT_FEE) do mesmo pagamento viram UMA linha (líquido), porque o
  webhook credita o líquido e a taxa já é AP PAGO.
- Retirada de sócios = PIX para AQUALIFE (e PF dos sócios); assinaturas/serviços = despesa da PT.
- ERP: só `main`, tag `pre-deploy-*` antes, avisar o Karlão antes de publicar; schema aplicado por `prisma db push` no start.
- Valores sempre em centavos (Int); datas de lançamento sem hora (`@db.Date`).

## Review Focus

- Saída no extrato do Itaú ("-600,00") lida como +600 e casada com uma OS de R$ 600 — esperado: sinal preservado,
  saída nunca vira entrada (teste na Task 4).
- Rotina rodada duas vezes no mesmo dia — esperado: nenhuma linha duplicada, saldo igual (testes nas Tasks 2 e 3).
- Repasse da Rede / PIX QRS em que só parte das vendas tem crédito no ERP — esperado: liga o que existe e lança só a
  DIFERENÇA como "Receita a identificar" (teste na Task 2).
- Ajuste de caixa chamado de novo — esperado: não cria segundo ajuste (teste na Task 3).
- Linha anterior ao corte reaparecendo no extrato de 30 dias — esperado: ignorada (teste na Task 2).

---

### Task 1: Categoria e origem no lançamento + regras de classificação (schema e categorias)

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (models `Transaction`, `Category`; novo `ClassificationRule`)
- Create: `apps/web/src/lib/financeiro/livro-categorias.ts`
- Test: `apps/web/src/lib/financeiro/livro-categorias.test.ts`

**Interfaces:**
- Produces: `Transaction.category_id String?`, `Transaction.origin String?` (`'BANCO' | 'AJUSTE'`),
  `Transaction.source_text String?` (texto original da linha), `Transaction.counterparty String?`;
  `ClassificationRule { id, company_id, pattern String, direction String? ('IN'|'OUT'), account_id String?,
  category_id String, priority Int @default(100), active Boolean @default(true), created_at }`;
  `CATEGORIAS_LIVRO: { nome: string; modulo: 'financeiro_despesa' | 'financeiro_receita' }[]`;
  `REGRAS_INICIAIS: { pattern: string; direction: 'IN' | 'OUT'; categoria: string }[]`;
  `async function garantirCategoriasERegras(tx, companyId: string): Promise<Map<string, string>>` (nome → id).

- [ ] **Step 1: Teste** `CATEGORIAS_LIVRO e REGRAS_INICIAIS são coerentes`: toda `regra.categoria` existe em
  `CATEGORIAS_LIVRO` ou nas categorias já existentes (`Impostos`, `Salarios`, `Retirada Socios`, `Combustiveis`,
  `Taxas de Cartao (Operadora)`); contém `Ajuste de caixa`, `A classificar`, `Transferência entre contas`,
  `Transferência entre empresas`, `Receita a identificar` (receita), `Rendimentos` (receita), `Anúncios`,
  `Sistemas e Assinaturas`, `Telefone e Internet`, `Energia`, `Despesas Bancárias`, `Peças e Fornecedores`; regras
  contêm `{pattern:'GOOGLE ADS', direction:'OUT', categoria:'Anúncios'}`, `MICROSOFT*ADS`→Anúncios,
  `FACEBK`→Anúncios, `MINISTERIO DA FAZENDA`→Impostos, `AQUALIFE`→Retirada Socios, `CLARO`→Telefone e Internet,
  `ELETROPAULO`→Energia, `IOF`→Despesas Bancárias, `REND PAGO APLIC`→Rendimentos (IN), `YOUTUBE`/`GOOGLE ONE`/
  `GOOGLE CLOUD`/`TINY ERP`/`RESEND`→Sistemas e Assinaturas, `BANCO INTER S A`→Transferência entre contas (pagamento da
  fatura do cartão Inter até existir a conta-cartão no Plano 2).
- [ ] **Step 2: Rodar** `cd apps/web && npx vitest run src/lib/financeiro/livro-categorias.test.ts` → FAIL (módulo inexistente).
- [ ] **Step 3: Implementar** o schema (relação `Transaction.categories → Category`, `Category.transactions`) e
  `livro-categorias.ts`; `garantirCategoriasERegras` faz upsert por (company_id, module, name) e cria a regra só se
  não houver outra com o mesmo `pattern`+`direction`.
- [ ] **Step 4: Rodar** o teste → PASS; `npx prisma validate --schema=../../packages/db/prisma/schema.prisma` → ok;
  `npx tsc --noEmit -p tsconfig.json` → 0 erros.
- [ ] **Step 5: Commit** `feat(livro): categoria/origem no lançamento + regras de classificação`.

### Task 2: Núcleo puro do livro (classificar, planejar lançamento)

**Files:**
- Create: `apps/web/src/lib/financeiro/livro.ts`
- Test: `apps/web/src/lib/financeiro/livro.test.ts`

**Interfaces:**
- Consumes: tipos da Task 1.
- Produces:
  `interface LinhaBanco { chave: string; data: string /*AAAA-MM-DD*/; descricao: string; valor_centavos: number /* + entra, − sai */; contraparte?: string; links?: string[] /* bank_ref de créditos já existentes */ }`;
  `function classificar(linha: LinhaBanco, regras: { id: string; pattern: string; direction: string | null; account_id: string | null; category_id: string; priority: number }[], accountId: string): { category_id: string | null; regra_id: string | null }`
  (case-insensitive substring do pattern em `descricao + ' ' + contraparte`; respeita direction pelo sinal e
  account_id; menor `priority` vence);
  `type Plano = { acao: 'IGNORAR'; motivo: string } | { acao: 'LIGAR'; refs: string[] } | { acao: 'CRIAR'; valor_centavos: number; refs_ligadas: string[]; identificar: boolean }`;
  `function planejarLinha(linha: LinhaBanco, corte: string, jaLancada: boolean, creditosExistentes: { bank_ref: string; amount: number }[]): Plano`.

- [ ] **Step 1: Testes** (`describe('planejarLinha')`):
  `data <= corte ('2026-10-29') → IGNORAR`; `jaLancada → IGNORAR`; `links somam exato o valor → LIGAR com as refs`;
  `links somam menos (só parte das vendas creditada) → CRIAR valor = linha − soma, refs_ligadas = as que existem, identificar = true`;
  `links somam MAIS que a linha (crédito bruto de antes da mudança do Asaas) → CRIAR a diferença negativa, identificar = false`;
  `link inexistente no ERP é tratado como ausente`; `sem links → CRIAR valor total, identificar = false`;
  `saída (valor < 0) → CRIAR valor negativo`.
  (`describe('classificar')`): `'PIX ENVIADO AQUALIFE DIVE' OUT → Retirada Socios`; `'Transação via Pix com QR Code para BANCO INTER S A' OUT → Transferência entre contas`;
  `'Google ADS8064036062' OUT → Anúncios`; `regra OUT não pega entrada`; `nenhuma → {category_id:null}`;
  `duas regras → menor priority vence`.
- [ ] **Step 2: Rodar** `npx vitest run src/lib/financeiro/livro.test.ts` → FAIL.
- [ ] **Step 3: Implementar** `classificar` e `planejarLinha` em `livro.ts`.
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `feat(livro): núcleo puro (classificar + planejar linha)`.

### Task 3: Rotas do livro (lançar linhas, ajuste de caixa, classificar)

**Files:**
- Create: `apps/web/src/app/api/financeiro/livro/linhas/route.ts`, `.../livro/ajuste/route.ts`,
  `.../livro/transacoes/[id]/route.ts`
- Create: `apps/web/src/lib/financeiro/livro-ajuste.ts` + `livro-ajuste.test.ts`

**Interfaces:**
- Consumes: `classificar`, `planejarLinha` (Task 2); `garantirCategoriasERegras` (Task 1).
- Produces:
  `POST /api/financeiro/livro/linhas` (financeiro.edit) body `{ account_id, corte: '2026-10-29', linhas: LinhaBanco[], simular?: boolean }`
  → `{ data: { resultados: { chave, acao, valor_centavos?, categoria?, transaction_id? }[], saldo_erp_centavos } }`.
  Em `$transaction` por linha: `jaLancada` = existe `Transaction` com `bank_ref = chave` na conta; CRIAR →
  `Transaction` (CREDIT se > 0, DEBIT se < 0, `amount` absoluto, `bank_ref = chave`, `origin 'BANCO'`,
  `category_id` = classificar() ou "A classificar" / "Receita a identificar" se `identificar`, `source_text`,
  `counterparty`, `reconciled true`) + `current_balance` ±; LIGAR → marca as transações `refs` como
  `reconciled = true` e grava `Transaction` "marcador" NÃO (não cria nada; só registra no resultado).
  `POST /api/financeiro/livro/ajuste` body `{ account_id, saldo_real_centavos, data_corte: '2026-10-29', simular?: boolean }`
  → `{ data: { saldo_erp_atual, ajuste_centavos, transaction_id? } }` (ajuste = real − `current_balance` no momento).
  `PATCH /api/financeiro/livro/transacoes/[id]` body `{ category_id, criar_regra?: { pattern, direction } }`.
  `function calcularAjuste(saldoRealCentavos: number, saldoErpCentavos: number): { tipo: 'CREDIT' | 'DEBIT' | null; amount: number }`.

- [ ] **Step 1: Testes** `calcularAjuste(9944636, 61977066)` → `{tipo:'DEBIT', amount: 52032430}`;
  `calcularAjuste(100, 40)` → `{tipo:'CREDIT', amount: 60}`; `calcularAjuste(5, 5)` → `{tipo:null, amount:0}`.
- [ ] **Step 2: Rodar** `npx vitest run src/lib/financeiro/livro-ajuste.test.ts` → FAIL.
- [ ] **Step 3: Implementar** `livro-ajuste.ts` e as três rotas. Ajuste: `bank_ref = 'AJUSTE:<account_id>:<data_corte>'`;
  se já existir, devolve o existente (idempotente); `transaction_date = data_corte`; categoria "Ajuste de caixa";
  CREDIT se ajuste > 0, DEBIT se < 0; atualiza `current_balance`. `simular: true` não grava nada nas três rotas.
- [ ] **Step 4: Rodar** suíte inteira `npx vitest run` → tudo verde; `npx tsc --noEmit -p tsconfig.json` → 0 erros.
- [ ] **Step 5: Commit** `feat(livro): rotas de lançamento, ajuste de caixa e classificação`; publicar (tag
  `pre-deploy-livro-fase1-<data>`, avisar o Karlão, deploy Coolify, conferir commit do deployment).

### Task 4: Extrato do Itaú com entradas E saídas e saldo do dia (rotina)

**Files:**
- Modify: `rotina/itau/extrato_cdp.cjs` (filtro "Todos"; manter tela JSON)
- Modify: `rotina/itau/conciliar.cjs` (função `centavos` com sinal; `preparar` só entradas)
- Modify: `rotina/itau/regras-conciliacao.cjs` + `regras-conciliacao.test.cjs`

**Interfaces:**
- Produces: `centavosComSinal(txt: string): number` em `regras-conciliacao.cjs` ("-600,00" → −60000;
  "1.401,83" → 140183; "+R$ 253,70" → 25370); `saldoDoDia(linhas, dia): number | null` (lê a coluna saldo da linha
  "SALDO TOTAL DISPONÍVEL DIA" daquele dia).

- [ ] **Step 1: Testes** `node --test`: `centavosComSinal('-600,00') === -60000`; `centavosComSinal('1.401,83') === 140183`;
  `saldoDoDia([{cel:['28/out','SALDO TOTAL DISPONÍVEL DIA','','99.446,36']}],'28/out') === 9944636`.
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar**; `extrato_cdp.cjs` marca o rádio "Todos" (não "Entradas"); em `conciliar.cjs`
  `preparar` passa a usar `centavosComSinal` e filtrar `c > 0` (saída nunca é candidata a AR).
- [ ] **Step 4: Rodar** `node --test regras-conciliacao.test.cjs` → PASS; regressão
  `CONCILIAR_IGNORAR_USADOS=1 node conciliar.cjs aplicar <scratchpad>/conciliacao/regressao3 --simular` → "quitadas 16".
- [ ] **Step 5:** sem commit (rotina fora do git); registrar em `rotina/itau/conciliacao.ps1` cabeçalho a mudança.

### Task 5: Montar as linhas do livro (Itaú + Asaas) com chave e vínculos (rotina)

**Files:**
- Create: `rotina/itau/livro.cjs` (modo `node livro.cjs <pastaDia> [--simular]`)
- Modify: `rotina/itau/regras-conciliacao.cjs` + teste (funções puras da chave e dos vínculos)

**Interfaces:**
- Consumes: `extrato.json` do dia (Task 4), `detalhes.json`, `resultado_cartao.json`, `conciliacoes_PT.jsonl`,
  `GET /api/financeiro/asaas/extrato`, `POST /api/financeiro/livro/linhas` (Task 3).
- Produces: `chaveItau(linha: {dia, desc, valor}, ordemNoDia: number, e2e?: string): string` → `'ITAU:E2E:<e2e>'` se
  houver E2E, senão `'ITAU:<AAAA-MM-DD>|<desc normalizada>|<centavos>|<ordem>'`; `chaveAsaas(id) → 'ASAAS:<id>'`;
  `vinculosItau(linha, conciliacoes, cartao): string[]` → `AR:<ar>` dos PIX/QRS/Dinheiro liquidados por aquela linha
  e `acquirer:rede:<NSU>` das vendas do repasse;
  `linhasAsaas(lancamentos): LinhaBanco[]` → junta PAYMENT_RECEIVED + PAYMENT_FEE do mesmo `payment_id` numa linha
  (valor = soma, chave `ASAAS:PAY:<payment_id>`, `links = [payment_id]`); TRANSFER e NOTIFICATION_FEE ficam linhas
  próprias (`ASAAS:<id do lançamento>`).

- [ ] **Step 1: Testes** `node --test`: `chaveItau` estável para a mesma linha em duas execuções; duas linhas iguais
  no mesmo dia geram chaves diferentes pela ordem; `vinculosItau` de "RECEBIMENTO REDE MAST DB" 28/out → contém
  `acquirer:rede:185457004` (venda da 62873); de "PIX RECEBIDO ARTUS" 28/out → `AR:d5a15580-024c-40e7-a095-23cdbb45ac34`; `linhasAsaas` de
  `[{RECEIVED +634,50 pay_1},{FEE −1,99 pay_1},{TRANSFER −1000}]` → 2 linhas: `{valor:63251, links:['pay_1']}` e a transferência.
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar** as funções e `livro.cjs`: lê as linhas do Itaú com data > corte (ignora SALDO),
  as do Asaas (`/asaas/extrato` do corte até hoje), monta `LinhaBanco[]` por conta e chama `/livro/linhas`
  (conta Itaú `0732aeac-3d29-4c4e-aa84-a9988dd0c894`, Asaas `53a061c4-3381-42d4-b58d-4aa5bdd31337`). `--simular` passa
  `simular: true`. Grava `resultado_livro.json` (por conta: criadas, ligadas, a classificar, saldo ERP × real).
- [ ] **Step 4: Rodar** `node livro.cjs <pastaDia> --simular` com o extrato de 29/10 → nenhuma linha anterior ao
  corte; "RECEBIMENTO REDE" ligado; nenhuma linha duplicada.
- [ ] **Step 5:** registrar no cabeçalho de `livro.cjs` a origem do pedido (Karlão 29/10).

### Task 6: Corte — ajuste de caixa nas contas (execução única, 30/10 cedo)

**Files:** nenhum novo; usa `/livro/ajuste` (Task 3). Rodar DEPOIS dos passos de conciliação da rotina de 30/10 e
ANTES do primeiro `livro.cjs`.

- [ ] **Step 1:** Itaú: saldo real = coluna saldo de "SALDO TOTAL DISPONÍVEL DIA" 29/out no extrato de 30/10 →
  `simular` → mostrar ao Karlão `saldo_erp_atual`, saldo real e `ajuste_centavos`.
- [ ] **Step 2:** Asaas: saldo real no fim de 29/10 = `balance` do último lançamento ≤ 29/10 do `/asaas/extrato`
  (ou `saldo_asaas_centavos` se não houve lançamento depois) → `simular` → mostrar.
- [ ] **Step 3:** Inter: saldo real no fim de 29/10 lido no site (Chrome 9341) → `simular` → mostrar.
- [ ] **Step 4:** Com o OK do Karlão, rodar sem `simular` nas três; conferir em `GET /contas-bancarias` que o saldo
  ERP de cada conta = saldo real do fim de 29/10.
- [ ] **Step 5:** rodar de novo o ajuste → resposta com o mesmo `transaction_id` (idempotente).

### Task 7: Ligar na rotina das 07:45 e no resumo

**Files:**
- Modify: `rotina/itau/conciliacao.ps1` (passo `livro` depois de `Asaas`)
- Modify: `rotina/prompt-resumo.txt` (seção "Entradas e saídas do dia por conta e por categoria")

- [ ] **Step 1:** adicionar `Passo 'livro' @('livro.cjs', $D)` depois do passo Asaas; garantir BOM e 0 erros de
  sintaxe (`[System.Management.Automation.Language.Parser]::ParseFile`).
- [ ] **Step 2:** no `prompt-resumo.txt`, ler `itau/dias/<data>/resultado_livro.json` e mostrar por conta: entradas,
  saídas por categoria, lista "a classificar", saldo real × ERP (diferença ≠ 0 em vermelho).
- [ ] **Step 3:** disparar `Start-ScheduledTask 'Varredura Conciliacao Itau'` e conferir no log
  `logs/conciliacao_<data>.log` o passo `livro` com 0 duplicatas e saldo ERP = real nas duas contas.
