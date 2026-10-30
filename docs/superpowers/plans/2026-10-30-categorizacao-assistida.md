# Categorização assistida do livro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** todo lançamento do banco (Itaú e Asaas) termina o dia com categoria real: a rotina pergunta ao Karlão o que não sabe, cada resposta vira regra, e baixas de contas a receber/pagar passam a usar o lançamento do livro em vez de criar outro.

**Architecture:** ERP (Next.js + Prisma, worktree `C:\dev\pontual-erp-livro`, branch nova `feat/categorizacao-assistida` a partir de `main`) ganha: vínculo `transactions.linked_ref`, baixa AR/AP que reaproveita o lançamento do livro, PATCH de categoria que deriva a regra e recategoriza o passado, edição rápida no Extrato e o resumo "realizado no banco por categoria". A rotina (fora do git, `C:\Users\pontu\Downloads\dia a dia\rotina\itau`) ganha `categorias.cjs` (perguntar/responder pelo WhatsApp "(você)", interpretação por `claude -p`) ligado ao `conciliacao.ps1`.

**Tech Stack:** Next.js 14 route handlers, Prisma (PostgreSQL), zod, vitest (`apps/web`: `npx vitest run <arquivo>`); Node 24 CommonJS + `node --test` na rotina; Chrome CDP 9333 (ERP logado como Roberto + WhatsApp Web).

**Spec:** `docs/superpowers/specs/2026-10-30-categorizacao-assistida-design.md` (aprovado pelo Karlão 30/10). Base: `docs/superpowers/specs/2026-10-29-financeiro-espelho-do-banco-design.md` e o plano `docs/superpowers/plans/2026-10-29-livro-razao-fase1.md`.

## Global Constraints

- Contas do livro: Itaú `0732aeac-3d29-4c4e-aa84-a9988dd0c894`, Asaas `53a061c4-3381-42d4-b58d-4aa5bdd31337`. Inter (`94938baa-1484-4a87-b699-e2c73a562a59`) fora do livro.
- Categorias "fallback" (as únicas que a rotina pergunta e que uma regra nova pode recategorizar): `A classificar` (saída) e `Receita a identificar` (entrada). Nunca sobrescrever outra categoria.
- Categoria nova `Receita de serviços` (module `financeiro_receita`) — adicionar a `CATEGORIAS_LIVRO`.
- Fora do total do "realizado" (listadas à parte): `Ajuste de caixa`, `Transferência entre contas`, `Transferência entre empresas`.
- Toda mensagem da rotina no WhatsApp começa com `Varredura —`; destino só a conversa `(você)`; envio por `whatsapp-texto.cjs`, leitura por `ler-voce.cjs <HH:MM>`.
- Respostas de categoria começam com **`cat`** (ex.: `cat 1 ok, 2 salários, 3 ?`). Motivo: os orçamentos também pedem "1 ok" no mesmo "(você)".
- Todo script da rotina que toca ERP ou WhatsApp roda com a trava `passada.lock` (o `conciliacao.ps1` já segura; avulso: `com_lock.cjs`).
- Baixa de AR por resposta do Karlão só com as travas da conciliação: AR não conciliada, da mesma conta do lançamento, valor igual ou diferença ≤ R$ 1,00 (diferença vai na nota da OS), lançamento ainda em fallback e sem `linked_ref`.
- Rotina: cópia de cada arquivo alterado em `C:\dev\pontual-erp-livro\.superpowers\sdd\2026-10-30-categorizacao\<task>-antes\` antes de editar; `.ps1` em UTF-8 **com BOM**; nunca logar URL/token do banco.
- ERP: deploy só da `main`, tag `pre-deploy-categorizacao-AAAA-MM-DD` antes, avisar o Karlão antes, no máximo 1 deploy a cada 2 h; migration só aditiva (coluna nula).

## Review Focus

1. **Baixa depois do livro conta o dinheiro 2x** — dar baixa numa AR/AP cuja linha o livro já lançou deve ligar, não criar transação nem mexer no saldo (testes em Task 1 `decidirBaixa`).
2. **Regra genérica demais** ("PIX ENVIADO", "TAR", nome curto) recategoriza em massa — `padraoDaLinha` devolve `null` e nenhuma regra é criada (Task 3).
3. **Resposta a uma pergunta antiga** com numeração de outra rodada — a resposta é sempre casada com a ÚLTIMA pergunta enviada antes dela (Task 7 `perguntaDaResposta`).
4. **Karlão já corrigiu no ERP** antes da rotina aplicar a resposta do WhatsApp — só aplica se o lançamento ainda estiver em fallback (Task 7 `planejarRespostas`).
5. **"1 ok" dos orçamentos lido como categoria (ou o contrário)** — categorias só lê mensagens que começam com `cat`; a aplicação dos orçamentos ignora mensagens que começam com `cat` (Tasks 7 e 9).

---

### Task 1: Vínculo do livro e decisão da baixa (ERP, puro + migration)

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (model `Transaction`: `linked_ref String?` + `@@index([linked_ref])`)
- Create: `packages/db/prisma/migrations/20261030120000_transactions_linked_ref/migration.sql` (`ALTER TABLE transactions ADD COLUMN linked_ref TEXT; CREATE INDEX ...`)
- Modify: `apps/web/src/lib/financeiro/livro-categorias.ts` (adicionar `{ nome: 'Receita de serviços', modulo: 'financeiro_receita' }`)
- Create: `apps/web/src/lib/financeiro/livro-baixa.ts`
- Test: `apps/web/src/lib/financeiro/livro-baixa.test.ts`

**Interfaces:**
- Produces:
  - `export const CATEGORIAS_FALLBACK = ['A classificar', 'Receita a identificar'] as const`
  - `export const JANELA_BAIXA = { antes: 10, depois: 1 }` (dias, em torno da data da baixa)
  - `export interface CandidatoLivro { id: string; amount: number; transaction_type: 'CREDIT'|'DEBIT'; transaction_date: string /*AAAA-MM-DD*/; categoria: string|null; linked_ref: string|null; origin: string|null }`
  - `export function decidirBaixa(alvo: { tipo: 'CREDIT'|'DEBIT'; amount: number; data: string }, explicito: string|null, candidatos: CandidatoLivro[]): { usar: string } | { criar: true } | { erro: string }`
    - explícito: precisa estar nos candidatos, ser `origin 'BANCO'`, mesmo tipo, `linked_ref` nulo, categoria em fallback, |amount − alvo.amount| ≤ 100 → `{usar}`; senão `{erro}` com o motivo.
    - automático: candidato `origin 'BANCO'`, mesmo tipo, **mesmo amount**, `linked_ref` nulo, categoria em fallback, data em [data − 10, data + 1]; mais próximo da data vence; nenhum → `{criar: true}`.

- [ ] **Step 1: Write the failing tests** (`livro-baixa.test.ts`)

```ts
const base = { transaction_type: 'CREDIT' as const, origin: 'BANCO', linked_ref: null, categoria: 'Receita a identificar' }
it('usa o lançamento do livro de mesmo valor dentro da janela', () => {
  expect(decidirBaixa({ tipo: 'CREDIT', amount: 63627, data: '2026-10-30' }, null,
    [{ ...base, id: 'L1', amount: 63627, transaction_date: '2026-10-29' }])).toEqual({ usar: 'L1' })
})
it('cria quando o único candidato já está ligado', () => {
  expect(decidirBaixa({ tipo: 'CREDIT', amount: 63627, data: '2026-10-30' }, null,
    [{ ...base, id: 'L1', amount: 63627, transaction_date: '2026-10-29', linked_ref: 'AR:x' }])).toEqual({ criar: true })
})
it('não usa lançamento já categorizado (fora do fallback)', () => {
  expect(decidirBaixa({ tipo: 'DEBIT', amount: 5000, data: '2026-10-30' }, null,
    [{ ...base, transaction_type: 'DEBIT', id: 'L2', amount: 5000, transaction_date: '2026-10-30', categoria: 'Energia' }])).toEqual({ criar: true })
})
it('explícito com diferença de 85 centavos é aceito', () => {
  expect(decidirBaixa({ tipo: 'CREDIT', amount: 54915, data: '2026-10-30' }, 'L3',
    [{ ...base, id: 'L3', amount: 55000, transaction_date: '2026-10-29' }])).toEqual({ usar: 'L3' })
})
it('explícito de outro tipo dá erro', () => {
  expect(decidirBaixa({ tipo: 'CREDIT', amount: 100, data: '2026-10-30' }, 'L4',
    [{ ...base, transaction_type: 'DEBIT', id: 'L4', amount: 100, transaction_date: '2026-10-30' }])).toHaveProperty('erro')
})
it('fora da janela (11 dias antes) cria', () => {
  expect(decidirBaixa({ tipo: 'CREDIT', amount: 100, data: '2026-10-30' }, null,
    [{ ...base, id: 'L5', amount: 100, transaction_date: '2026-10-19' }])).toEqual({ criar: true })
})
```

- [ ] **Step 2:** `cd apps/web && npx vitest run src/lib/financeiro/livro-baixa.test.ts` → FAIL (módulo não existe)
- [ ] **Step 3:** implementar `livro-baixa.ts`; schema + migration; categoria nova em `CATEGORIAS_LIVRO`; `npx prisma generate` (em `packages/db`)
- [ ] **Step 4:** `npx vitest run src/lib/financeiro` → PASS; `npx tsc --noEmit -p apps/web` → limpo
- [ ] **Step 5: Commit** `feat(livro): vínculo linked_ref e decisão de baixa sobre o lançamento do livro`

### Task 2: Baixa de AR e de AP reaproveitando o lançamento do livro (ERP, rotas)

**Files:**
- Modify: `apps/web/src/app/api/financeiro/contas-receber/bulk-reconcile/route.ts`
- Modify: `apps/web/src/app/api/financeiro/contas-pagar/[id]/baixa/route.ts`
- Modify: `apps/web/src/app/api/financeiro/contas-pagar/[id]/estornar/route.ts`
- Create: `apps/web/src/lib/financeiro/livro-baixa-db.ts` (busca de candidatos com o `tx` do Prisma)

**Interfaces:**
- Consumes: `decidirBaixa`, `CandidatoLivro`, `CATEGORIAS_FALLBACK`, `JANELA_BAIXA` (Task 1).
- Produces:
  - `export async function candidatosLivro(tx, companyId: string, accountId: string, tipo: 'CREDIT'|'DEBIT', data: string, explicito: string|null): Promise<CandidatoLivro[]>` (janela `JANELA_BAIXA`; inclui o explícito mesmo fora da janela)
  - bulk-reconcile body: `{ ids: string[], reconciled: boolean, livro?: Record<string /*arId*/, string /*transactionId*/> }`; resposta ganha `ligadas: number` e `erros: {ar: string, motivo: string}[]`.
  - baixa AP body: `+ livro_transaction_id?: string`; resposta ganha `ligada: boolean`.
- Comportamento (reconciled=true): existência passa a checar `bank_ref in [AR:id, ...]` **ou** `linked_ref = 'AR:'+id`. `decidirBaixa` → `{usar}`: na mesma `$transaction`, AR LIQUIDADO, o lançamento recebe `linked_ref 'AR:<id>'`, `category_id` = categoria da AR ou `Receita de serviços`, `description` = `LIQUIDACAO: <ar.description> · banco: <source_text>`; **saldo não muda**. `{criar}`: como hoje, mas a transação criada recebe `category_id` (AR.category_id ?? Receita de serviços). `{erro}` (só com explícito): não baixa, vai em `erros`.
- reconciled=false com lançamento ligado (`linked_ref = AR:id`): limpa `linked_ref`, volta a categoria para `Receita a identificar`, description = `source_text`; **não apaga nem mexe no saldo**.
- AP: igual com `AP:<id>`, tipo DEBIT, `paid_amount` = valor; categoria = AP.category_id (sem categoria → mantém `A classificar`). Estornar de AP ligada: desliga (não cria CREDIT compensatório, saldo intacto).

- [ ] **Step 1:** teste de rota com Prisma simulado em `apps/web/src/app/api/financeiro/contas-receber/bulk-reconcile/route.test.ts` (seguir o padrão de `apps/web/src/app/api/public/unsubscribe/route.test.ts`): (a) AR com lançamento do livro casando → nenhum `transaction.create`, nenhum `account.update`, `transaction.update` com `linked_ref: 'AR:a1'`; (b) sem candidato → `transaction.create` com `category_id` de "Receita de serviços"; (c) desfazer ligado → `transaction.update` com `linked_ref: null` e sem `delete`.
- [ ] **Step 2:** rodar → FAIL
- [ ] **Step 3:** implementar `livro-baixa-db.ts` e as três rotas
- [ ] **Step 4:** `npx vitest run` (suite inteira do apps/web) → PASS; `tsc` limpo
- [ ] **Step 5: Commit** `feat(financeiro): baixa de AR/AP liga ao lançamento do livro em vez de criar outro`

### Task 3: Categoria do lançamento + regra derivada + retroativo (ERP)

**Files:**
- Create: `apps/web/src/lib/financeiro/livro-padrao.ts` · Test: `livro-padrao.test.ts`
- Modify: `apps/web/src/app/api/financeiro/livro/transacoes/[id]/route.ts`

**Interfaces:**
- Produces:
  - `export function padraoDaLinha(texto: string): string | null` — maiúsculas, tira prefixos (`PIX ENVIADO`, `PIX RECEBIDO`, `PIX QRS`, `TRANSAÇÃO VIA PIX COM CHAVE PARA`, `TRANSAÇÃO VIA PIX COM QR CODE PARA`, `TRANSAÇÃO VIA PIX COM DADOS MANUAIS PARA`, `PAGAMENTO`, `PAG BOLETO`, `TED`, `DOC`, `SISPAG`), data colada no fim (`\d{2}/\d{2}$`), números longos (≥5 dígitos), espaços extras; resultado `< 4` letras ou numa lista proibida (`PIX`, `TED`, `DOC`, `TAR`, `TARIFA`, `BOLETO`, `TRANSF`, `PAGAMENTO`, `RECEBIDO`, `ENVIADO`) → `null`.
  - PATCH body: `{ category_id: string; simular?: boolean; nota?: string; criar_regra?: { pattern?: string|null; direction: 'IN'|'OUT'|null } }` — `pattern` ausente ⇒ `padraoDaLinha(source_text ?? description)`; `null` ⇒ não cria regra (resposta `regra: null, motivo_sem_regra`). `nota` ⇒ `description = (source_text ?? description) + ' — ' + nota`.
  - Resposta: `{ id, category_id, regra: { pattern, direction } | null, motivo_sem_regra?: string, recategorizadas: number, simulado?: true }`. Com regra nova: recategoriza as outras transações da empresa com categoria em fallback, `origin 'BANCO'`, mesma direção (CREDIT↔IN, DEBIT↔OUT) e `source_text` contendo o padrão (case-insensitive).

- [ ] **Step 1: failing tests** (`livro-padrao.test.ts`):
```ts
expect(padraoDaLinha('PIX ENVIADO ELVIS FERREIRA')).toBe('ELVIS FERREIRA')
expect(padraoDaLinha('Transação via Pix com chave para ELVIS FERREIRA DE FRANCA')).toBe('ELVIS FERREIRA DE FRANCA')
expect(padraoDaLinha('Transação via Pix com QR Code para MINISTERIO DA FAZENDA')).toBe('MINISTERIO DA FAZENDA')
expect(padraoDaLinha('PIX RECEBIDO ROGERIO29/10')).toBe('ROGERIO')
expect(padraoDaLinha('PIX ENVIADO')).toBeNull()
expect(padraoDaLinha('TAR PACOTE 123456')).toBe('TAR PACOTE')
expect(padraoDaLinha('TED 12345678')).toBeNull()
```
- [ ] **Step 2:** FAIL · **Step 3:** implementar lib + rota (retroativo dentro da mesma `$transaction`) · **Step 4:** `npx vitest run src/lib/financeiro` PASS, `tsc` limpo
- [ ] **Step 5: Commit** `feat(livro): categorizar lançamento cria regra derivada do texto e corrige os parecidos`

### Task 4: Extrato mostra e edita a categoria dos lançamentos do livro (ERP, API + tela)

**Files:**
- Modify: `apps/web/src/app/api/financeiro/extrato/route.ts` (transações: `select` + `category_id`, `origin`, `source_text`, `created_at`, `categories.name`; item ganha `category_id`, `livro: origin === 'BANCO'`, `texto_banco` (= `source_text`), `criado_em` (ISO); `categoria` = nome; filtro `category_id` também nas transações)
- Modify: `apps/web/src/app/(dashboard)/financeiro/extrato/page.tsx` (edição rápida também para `origem === 'transacao' && livro`: select de categoria, campo "observação", caixa **"aplicar também aos próximos iguais"** marcada por padrão mostrando o padrão de `padraoDaLinha` — sem padrão: caixa desabilitada com "texto genérico, sem regra"; salva por `PATCH /api/financeiro/livro/transacoes/{id}` com `criar_regra: { direction }` quando marcada; toast mostra "regra 'X' criada · N parecidos corrigidos")

**Interfaces:** Consumes: PATCH da Task 3; `padraoDaLinha` (Task 3, importado no client).

- [ ] **Step 1:** teste puro do mapeamento: extrair `itemDeTransacao(t, contaNome)` para `apps/web/src/lib/financeiro/extrato-itens.ts` com teste (`categoria` vem de `categories.name`, `livro` true só com `origin 'BANCO'`, `categoria '—'` sem categoria)
- [ ] **Step 2:** FAIL · **Step 3:** implementar API + tela · **Step 4:** vitest PASS, `tsc` limpo, `npx next lint` sem erro novo
- [ ] **Step 5: Commit** `feat(extrato): categoria dos lançamentos do livro visível e editável, com regra`

### Task 5: Realizado no banco por categoria (ERP)

**Files:**
- Create: `apps/web/src/lib/financeiro/livro-resumo.ts` · Test: `livro-resumo.test.ts`
- Create: `apps/web/src/app/api/financeiro/livro/resumo/route.ts` (GET `from`, `to`, `account_id?`; contas do livro por padrão)
- Modify: `apps/web/src/app/(dashboard)/financeiro/fluxo-caixa/page.tsx` (quadro "Realizado no banco por categoria" com o período da página)

**Interfaces:**
- Produces:
  - `export function categoriaEfetiva(t: { transaction_type: string; bank_ref: string|null; categoria: string|null }): string` — com categoria → ela; sem: CREDIT com `bank_ref` começando `AR:`, `acquirer:` ou `pay_` → `Receita de serviços`; DEBIT `AP:` → `A classificar`; resto → `A classificar` (DEBIT) / `Receita a identificar` (CREDIT).
  - `export function resumoRealizado(ts: {transaction_type, amount, bank_ref, categoria}[]): { entradas: {categoria, total}[]; saidas: {categoria, total}[]; total_entradas: number; total_saidas: number; fora_do_total: {categoria, total}[] }` (ordenado por total desc; `fora_do_total` = Ajuste/Transferências).
  - GET resposta: `{ periodo, contas, ...resumoRealizado }` (centavos).
- DRE **não muda** (é por competência, de contas a receber/pagar) — registrar no ledger.

- [ ] **Step 1: failing tests** (`livro-resumo.test.ts`): ajuste −55104255 vai para `fora_do_total` e não entra em `total_saidas`; CREDIT `AR:x` sem categoria soma em `Receita de serviços`; duas saídas `Energia` somam numa linha.
- [ ] **Step 2:** FAIL · **Step 3:** implementar · **Step 4:** vitest PASS, `tsc` limpo
- [ ] **Step 5: Commit** `feat(livro): resumo do realizado no banco por categoria no fluxo de caixa`

### Task 6: Publicar o ERP (controlador, não subagente)

- [ ] tag `pre-deploy-categorizacao-2026-10-30` em `main`; merge `feat/categorizacao-assistida` → `main`; avisar o Karlão; deploy (regra 1/2 h); depois do deploy: `npx prisma migrate deploy` conferido (coluna `linked_ref` existe); fumaça: `PATCH /livro/transacoes/<id>` com `simular: true` num lançamento "A classificar" real → 200 com `regra`; `GET /livro/resumo?from=2026-10-30&to=2026-10-30` → 200.

### Task 7: Núcleo da categorização na rotina (puro)

**Files:**
- Create: `C:\Users\pontu\Downloads\dia a dia\rotina\itau\categorias-regras.cjs` · Test: `categorias-regras.test.cjs` (`node --test`)

**Interfaces:**
- Produces (CommonJS):
  - `FALLBACK = ['A classificar', 'Receita a identificar']`
  - `itensParaPerguntar(transacoes, estado, { agoraIso, ultimaRodadaIso, limite = 15, incluirNaoSei = false }) → item[]` — `transacoes`: `{id, data, tipo:'CREDIT'|'DEBIT', amount, texto, categoria, conta, criado_em}` (do Extrato: `texto_banco`, `criado_em`); só fallback; entrada (CREDIT) só se `criado_em < ultimaRodadaIso`; exclui `estado.nao_sei[id]` com data de hoje, salvo `incluirNaoSei` (o `categorias.cjs` liga na sexta ≥ 15h: lista "ainda sem categoria" do spec); novos primeiro, depois já perguntados (`ainda_sem_resposta: true`); corta em `limite`.
  - `formatarPergunta(itens, hora, palpites) → string` — 1ª linha `Varredura — Categorias ${hora} (${n} sem categoria)`; `${n}) dd/mm entrada|saída R$ x,xx Conta "texto"${palpite ? ' — palpite: '+palpite+'?' : ''}${ainda ? ' (ainda sem resposta)' : ''}`; última linha `Responda começando com cat: "cat 1 ok, 2 salários, 3 cliente OS 63010, 4 ?". "?" = não sei.`
  - `palpiteDe(item, { aps, historico }) → { texto, tipo: 'conta_pagar'|'categoria', ref? } | null` — AP em aberto mesmo valor, vencimento ±5 dias → `é a conta a pagar "desc" venc. dd/mm` (`ref` = AP id); senão categoria de resposta anterior com o mesmo `padrao` em `historico`.
  - `perguntaDaResposta(perguntas, horaResposta) → pergunta|null` — a última pergunta enviada antes da resposta.
  - `planejarRespostas(interpretacao, pergunta, transacoesAtuais, categorias) → op[]` — `interpretacao`: `[{n, acao:'categoria'|'ok'|'nao_sei'|'os'|'nao_entendi', categoria?, nova?: boolean, os?, nota?}]`; ops: `{tipo:'categorizar', id, category_id|nova_categoria, nota?, regra:true}`, `{tipo:'baixar_ap', id, ap}`, `{tipo:'baixar_os', id, os}` (categoriza Receita de serviços sem regra), `{tipo:'nao_sei', id}`, `{tipo:'pular', n, motivo}` — pula se o lançamento já saiu do fallback ("já categorizado no ERP"), se `n` não existe ou se `nao_entendi`; `ok` sem palpite → pular "sem palpite".
- [ ] **Step 1: failing tests** — no mínimo: entrada criada nesta rodada não entra; `nao_sei` de hoje não volta; resposta das 13:05 casa com a pergunta das 12:41, não com a das 07:12; `ok` num item com palpite de conta a pagar vira `baixar_ap`; item recategorizado no ERP vira `pular` com "já categorizado no ERP"; mensagem começa com `Varredura — Categorias`.
- [ ] **Step 2:** `node --test categorias-regras.test.cjs` → FAIL · **Step 3:** implementar · **Step 4:** PASS (e `node --test regras-conciliacao.test.cjs` continua PASS)
- [ ] **Step 5:** sem git: cópia final registrada no ledger

### Task 8: `categorias.cjs` — perguntar e responder (rotina, I/O)

**Files:**
- Create: `C:\Users\pontu\Downloads\dia a dia\rotina\itau\categorias.cjs`, `prompt-categorias.txt`; estado `categorias_estado.json` (`{ perguntas: [{enviada_em, hora, itens:[{n, id, palpite?}]}], nao_sei: {id: 'AAAA-MM-DD'}, historico: [{padrao, categoria}], ultima_resposta_lida }`)

**Interfaces:**
- Consumes: Task 7; ERP: `GET /api/financeiro/extrato?origem=transacao&account_id=…&from=…` (Task 4 fields), `GET /api/financeiro/contas-pagar?status=PENDENTE` (AP abertas), `PATCH /livro/transacoes/[id]` (Task 3), `POST /api/financeiro/contas-receber/bulk-reconcile` com `livro` (Task 2), `POST /api/financeiro/contas-pagar/[id]/baixa` com `livro_transaction_id` (Task 2), `POST /api/financeiro/categorias` (criar categoria — conferir o body na rota existente). ERP pela aba do Chrome 9333 (mesmo helper `erp.ev` do `livro.cjs`).
- CLI:
  - `node categorias.cjs perguntar <pastaDia>` — monta e envia (via `whatsapp-texto.cjs`); grava estado; imprime `perguntas: N`.
  - `node categorias.cjs responder [--texto "cat 1 ok, ..."]` — sem `--texto`: `ler-voce.cjs <HH:MM da pergunta mais antiga sem resposta>` e pega só mensagens que começam com `cat` (sem acento/caixa); interpreta com `claude -p` (`prompt-categorias.txt`: recebe a pergunta numerada, a lista de categorias e o texto; devolve SÓ o JSON de `interpretacao`); aplica `planejarRespostas`; `baixar_os`: acha a AR da OS (`GET /api/os/<n>` → AR da OS na mesma conta, não conciliada), checa as travas dos Global Constraints e chama bulk-reconcile com `livro: {arId: id}`; manda `Varredura — Categorias aplicadas HH:MM` com uma linha por item (`1 → Salários (regra 'ELVIS FERREIRA')`, `3 → OS 63010 baixada`, `4 → não entendi, pergunto de novo`).
- [ ] **Step 1:** `node categorias.cjs perguntar <pasta> --simular` (não envia, não grava) imprime a mensagem com os lançamentos fallback reais de 30/10.
- [ ] **Step 2:** `node categorias.cjs responder --texto "cat 1 ?" --simular` imprime as ops sem gravar.
- [ ] **Step 3:** teste real controlado com o Karlão: uma pergunta real + uma resposta dele; conferir no ERP a categoria, a regra e (se houver) a baixa.

### Task 9: Ligar na rodada + aviso + orçamentos ignoram "cat" (rotina)

**Files:**
- Modify: `itau\conciliacao.ps1` — logo depois da fila da trava esvaziar (antes de abrir o Itaú): pega a trava, `node categorias.cjs responder` (falha só vira log), solta; depois do `livro.cjs`: `node categorias.cjs perguntar $D` (com a trava já pega; falha só vira log).
- Modify: `itau\livro_aviso.cjs` — linha "categorizadas pelas regras: X · perguntadas: Y" a partir de `resultado_livro.json` (`criadas` − `a_classificar`).
- Modify: `rotina\orcamentos\prompt-aplicacao.txt` — "ignore mensagens que começam com `cat` ou com `Varredura —`".
- [ ] **Step 1:** parser do `.ps1` 0 erros e BOM `efbbbf`; `node --test` da rotina PASS.
- [ ] **Step 2:** rodada real seguinte (07:00/12:30/18:30) acompanhada: log mostra `categorias responder` e `perguntas: N`; mensagem chegou no "(você)".
