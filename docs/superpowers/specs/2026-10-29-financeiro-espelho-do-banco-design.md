# Financeiro do ERP como espelho do banco — desenho (PontualTech)

Data: 29/10/2026 · Pedido: Karlão (dono) · Escrito a partir da conversa de 29/10.

## 1. Intenção (o porquê)

O ERP tem módulo financeiro (contas a receber, contas a pagar, contas bancárias, transações, categorias, DRE, fluxo
de caixa), mas ele **não estava sendo alimentado**: só entradas eram lançadas, quase nenhuma saída. Resultado em
29/10: saldo do Itaú no ERP R$ 619.482,95 × banco R$ 99.456,62; Asaas no ERP R$ 177.848,12 × real R$ 14.744,69.

Palavras do Karlão: *"o erp precisa poder refletir toda a realidade financeira da empresa... quero saber o que sai,
o que entra por categoria, etc., a fim de poder ter melhores decisões"*; *"vamos lançar a partir de hoje tudo que
entra e tudo que sai"*; *"os saldos positivo e negativo vamos lançar como ajuste de caixa"*.

Sucesso = em qualquer dia, para cada conta, **saldo do ERP = saldo do banco**, e todo real que entrou ou saiu está
no ERP **com categoria** (e, quando é cliente, com a OS), de modo que entradas e saídas por categoria e por mês
sejam confiáveis para decisão.

## 2. Objetivos, não-objetivos, anti-objetivos

**Objetivos**
- Lançar no ERP, todo dia útil de manhã, **todas** as entradas e saídas do dia anterior de cada conta da PT.
- Categorizar cada saída (e cada entrada que não é de OS) por regras, aprendendo com a classificação humana.
- Zerar o passado com **um "Ajuste de caixa" por conta** na data de corte.
- Cartões de crédito empresariais: cada compra vira despesa na data da compra; pagamento da fatura **não** é
  despesa (é transferência).
- Relatório diário (no resumo das 18:15) "de onde veio e para onde foi cada real" + visão mensal por categoria no ERP.

**Não-objetivos (fase 1)**
- Imprimitech (ERP separado) — fase 2 com o mesmo modelo.
- Caixa em dinheiro na loja — o dinheiro dos motoristas é depositado no Itaú e aparece lá (DEP DIN ATM).
- Reclassificar ou corrigir lançamentos ANTERIORES ao corte (o passado vira um ajuste por conta).
- Emitir/pagar contas: o sistema só registra o que o banco mostra; não faz pagamento.

**Anti-objetivos (falha mesmo que "funcione")**
- **Contar o mesmo dinheiro duas vezes** (ex.: crédito da conta a receber + linha do extrato; despesa no cartão +
  pagamento da fatura; saída do Asaas para o Inter como despesa e entrada no Inter como receita).
- Saldo do ERP divergir do banco sem alerta.
- Lançar sem rastro: todo lançamento automático tem de apontar a linha de origem (banco, data, descrição, id).
- Precisar de iToken / acesso de transação: o acesso aos bancos é **só consulta**.
- **Passo manual recorrente.** Karlão: *"o que prefiro... nada manual"*. Toda fonte deve ser lida sozinha (API >
  login automatizado > arquivo enviado só em último caso). A única intervenção humana prevista é classificar o
  que ficou "a classificar" — e cada classificação vira regra para não se repetir.

## 3. Contas no escopo (fase 1)

| Conta | No ERP (Account) | Fonte da verdade | Acesso | Situação 29/10 |
|---|---|---|---|---|
| Itaú ag 0440 cc 20963-3 | ITAU PRINCIPAL `0732aeac` | extrato (tela) + detalhe por linha | login automatizado, acesso básico (`rotina/itau/*_cdp.cjs`) | funciona |
| Asaas | ASSAS `53a061c4` | `GET /api/financeiro/asaas/extrato` (servidor; IP liberado) | API Asaas | funciona |
| Inter (pouco usada; saldo 29/10 R$ 1.884,21) | Conta Inter `94938baa` | extrato da conta | API do Inter já configurada no ERP para boletos (`lib/boleto/provider-inter.ts`: mTLS com certificado A1, escopos `boleto-cobranca.read/write`). Extrato/saldo exigem o escopo `extrato.read` habilitado no app do Inter (portal do Inter) — testar pelo servidor, como o Asaas | a testar |
| Cartão Itaú Empresas Mastercard final 5290 | **nova conta tipo cartão** | fatura (Itaú Empresas → Cartões → Consultar lançamentos; abre no acesso básico) | mesmo login Itaú | visto 29/10 |
| Cartões Inter (3 cartões, UMA fatura e um limite: R$ 32.600; •••• 8059 PONTUAL LTDA e •••• 3742 ROGERIO = PT; •••• 1090 CHARLES CAMPOS = **só Imprimitech**) | **nova conta tipo cartão** | fatura consolidada no site (`contadigital.inter.co/cartao/consultar-cartao` → Exibir faturas): data, descrição, tipo (à vista / parcela n/m), valor; **não indica o cartão de cada compra** (testado 29/10 nos 3 cartões, histórico e detalhe) | login no Inter = **QR Code lido no app** (Central de Segurança → Token e Autorizações); Chrome próprio porta 9341, perfil `rotina/inter/perfil-chrome` — testar se a sessão dura dias | visto 29/10 |
| Stone | `516b0d9b` | — | — | sem uso: desativar |

## 4. Decisões já tomadas pelo Karlão

1. Começar **hoje (29/10)**; o passado de cada conta vira **"Ajuste de caixa"** (positivo ou negativo).
2. Contas a receber: liquidar **quando o dinheiro cai** (PIX/dinheiro no Itaú; cartão quando o repasse da Rede cai
   no Itaú; Asaas quando é creditado na conta Asaas). Já implementado (ERP 8c40a0f1 + bf214e78; rotina 07:45).
3. Quem paga pode ser outra pessoa/empresa; vale valor + favorecido + horário; nunca casar só por valor.
4. O Asaas é usado como banco (recebe, paga impostos, pessoal, retiradas, transfere).
5. Taxa nunca em dobro; dinheiro nunca em dobro.
6. Cartões empresariais: Inter e Itaú; compras precisam constar.
7. Inter do cartão: tentar API ("se conseguir criar uma api para o crédito... é o que prefiro, nada manual"),
   depois login; em último caso PDF.
8. **As empresas têm finanças separadas.** Dinheiro só cruza para desfazer engano: motorista passa o cartão na
   maquininha da empresa errada e depois uma devolve à outra ("RECEBIMENTOS IMPRIMI TECH" no Itaú da PT =
   devolução de vendas da PT que caíram na máquina da IMP). Venda da IMP na maquininha da PT **não é receita da
   PT** (é "a devolver à IMP"); venda da PT recebida pela IMP liquida a OS da PT quando a IMP devolve.
9. **Cartão Inter final 1090 é só da Imprimitech**; a **PT paga a fatura** e a IMP "reembolsa ou fica devendo às
   vezes" → as compras do 1090 são despesa da IMP e, no ERP da PT, viram **"a receber da IMP"**.
10. **PIX para a Aqualife (PJ do sócio), normalmente dia 1 e 15, ≈ R$ 10.000 = retirada de sócios** (às vezes
    depositada na PJ do sócio). Categoria "Retirada Socios", fora das despesas da operação.
11. **Assinaturas e serviços nos cartões/Asaas (YouTube, Google One, etc.) são despesa da PT** ("usamos no dia a
    dia"). Retirada só quando explícita (Aqualife / PF do sócio).
12. **Dinheiro em espécie:** o motorista deixa na ADM, que demora para depositar. Enquanto não for depositado, a OS
    fica **em aberto**; **cobrança diária no grupo ADM** + aviso ao Karlão; no depósito pode haver
    **arredondamento**.

## 5. Desenho

### 5.1 O livro-razão: uma linha do banco = um lançamento
- Cada linha de extrato/fatura com data ≥ corte vira **exatamente um** `Transaction` no ERP (CREDIT/DEBIT) na conta
  correspondente, com `bank_ref` = id estável da linha (Asaas: id do `financialTransaction`; Itaú PIX: ID E2E do
  detalhe; Itaú demais: chave data|descrição|valor|ordem no dia; Inter: id da API; cartão: data|descrição|valor|
  final do cartão|parcela). Idempotente: rodar duas vezes não duplica.
- **Ligar antes de criar.** Muitas entradas já geram crédito no ERP pela conciliação de contas a receber
  (`AR:<id>`, `acquirer:rede:<NSU>`, `pay_xxx`). Antes de criar, a linha do banco procura esses créditos e se
  **liga** a eles em vez de criar outro. Casos de soma: um "RECEBIMENTO REDE … AT/DB" = N créditos
  `acquirer:rede:*` das vendas do dia útil anterior; um "PIX QRS" = N créditos de AR do dia. A soma tem de fechar
  exata para ligar.
- **Linha que não fecha com nada no ERP é lançada mesmo assim** (decisão minha, decorrente de "saldo do ERP =
  banco" e "nada manual"): entra como "Receita a identificar" / "A classificar", com o texto da linha. O saldo
  continua batendo. Quando a OS/AR for identificada depois (rotina ou pessoa), a liquidação da AR
  (`perform-match`, `bulk-reconcile`, webhook) **reaproveita** esse lançamento — troca categoria e vínculo — em vez
  de criar outro crédito. Ex. de 29/10: 11 vendas da Rede sem OS, 3 repasses de início de outubro que não fecham,
  depósitos em dinheiro arredondados (DEP DIN ATM), PIX QRS sem comprovante.
- Saldo: o `current_balance` da conta só muda por esses lançamentos (e pelos da conciliação de AR, que passam a
  ser "ligados", não somados de novo).

### 5.2 Categorias
- Cada lançamento tem categoria (receita ou despesa). Entradas de OS herdam "Venda de Serviços/Peças" da AR.
- **Regras de classificação** (tabela nova, editável): padrão no texto da linha → categoria (+ fornecedor
  opcional). Ex.: `Google ADS` / `MICROSOFT*Ads` → Anúncios; `MINISTERIO DA FAZENDA` → Impostos; `CLARO` →
  Telefone/Internet; `ELETROPAULO` → Energia; `AQUALIFE` → Transferência entre empresas; `IOF` → Bancárias.
- Sem regra → categoria **"A classificar"**. Quando alguém classifica no ERP, oferece "criar regra para os
  próximos". Lista diária de "a classificar" no resumo.
- Categorias novas a criar (o construtor ajusta a lista): Anúncios/Marketing, Peças e Fornecedores,
  Telefone/Internet, Energia, Água, Sistemas/Software, Despesas Bancárias, Serviços de Terceiros, Transferência
  entre empresas, Transferência entre contas (não entra no resultado), Ajuste de caixa (não entra no resultado),
  A classificar.

### 5.3 Contas a pagar existentes
- Uma saída que bate com uma conta a pagar ABERTA (valor exato, vencimento até ±5 dias, favorecido compatível)
  dá baixa nela (status PAGO, conta bancária, data do banco) e usa a categoria dela — sem criar despesa nova.
  Ambiguidade (2+ candidatas) → pendência.
- Taxas que o ERP já cria como AP PAGO (Rede MDR/antecipação, Asaas) **não** geram saída de novo: no Itaú a Rede
  já credita líquido; no Asaas o extrato traz a taxa (PAYMENT_FEE) que deve ser ligada à AP de taxa existente.

### 5.4 Transferências entre contas próprias
- Saída numa conta + entrada noutra conta própria, mesmo valor, até 2 dias úteis → um par de lançamentos
  "Transferência entre contas" (não é despesa nem receita). Pagamento de fatura de cartão = transferência da conta
  bancária para a conta-cartão.

### 5.4b Conta corrente entre empresas (PT ↔ IMP)
- Conta não-bancária no ERP da PT, "Conta corrente IMP": saldo positivo = IMP deve à PT. Movimentos: PT paga a
  fatura do cartão Inter (parte do cartão 1090) → IMP passa a dever; IMP reembolsa → diminui; venda da IMP na
  maquininha da PT → PT passa a dever; venda da PT recebida pela IMP → IMP deve até devolver (aí liquida a OS da
  PT). Nada disso é receita/despesa da PT. Saldo aparece no relatório.
- Aqualife: não é conta corrente — PIX para ela = "Retirada Socios" (decisão 10).

### 5.4c Dinheiro em espécie (decisão 12)
- OS paga em dinheiro fica em aberto em "dinheiro na ADM aguardando depósito" (lista: OS, valor, motorista, data,
  dias parados).
- Cobrança: todo dia útil, enquanto houver pendência, mensagem no grupo ADM da PT (decisão minha: 09:00, uma
  mensagem por OS, seguindo a regra do Karlão de 21/10 para avisos no grupo) + total e lista no resumo das 18:15.
- Depósito "DEP DIN ATM" no Itaú: a rotina procura UM grupo de OS em aberto cuja soma bata com o depósito com
  tolerância de arredondamento (decisão minha: até R$ 5,00 por depósito); achou um só → liquida as OS e lança a
  diferença como "Arredondamento de caixa"; senão → "dinheiro a identificar" e a cobrança continua.

### 5.5 Cartões de crédito
- Conta nova por cartão no ERP (tipo cartão; saldo = dívida). Cada compra = despesa (DEBIT na conta-cartão) na
  data da compra, com categoria por regra; parcelas futuras entram na fatura em que aparecem.
- Pagamento da fatura no Itaú ("PAGAMENTO EFETUADO" na fatura / débito no extrato) = transferência Itaú → cartão.
- Cartão Inter: a fatura é paga também por outras contas (ex.: 13/10, PIX de R$ 16.035,43 do **Asaas** para o
  "Banco Inter" = "PGTO PIX +R$ 16.035,43" na fatura; "DEB AUT PARCIAL" da conta Inter) → transferência
  conta → cartão, nunca despesa. Créditos na fatura (estorno "CRED COMPRA INTERNAC", "EST IOF") reduzem a despesa.
- Compras do cartão Inter 1090 (IMP) → "a receber da IMP" (5.4b), não despesa da PT. Como a fatura do site não diz
  o cartão de cada compra, a separação depende da decisão pendente (seção 7).
- Corte: dívida em aberto na data de corte entra como Ajuste de caixa da conta-cartão (fatura de novembro do Itaú
  em 29/10: R$ 26.117,00, fechando 29/10, vencimento 11/11).

### 5.6 Corte e Ajuste de caixa ("a partir de hoje")
- Corte = **fim de 29/10** (corrigido no plano: a conciliação grava o crédito com a data do clique, então um corte
  por data contaria em dobro o dinheiro que caiu antes e foi liquidado depois). Em 30/10 cedo, depois da
  conciliação e antes do livro: por conta, `ajuste = saldo real no fim de 29/10 − saldo do ERP naquele momento`;
  1 `Transaction` "Ajuste de caixa" (CREDIT ou DEBIT), categoria Ajuste de caixa, datado 29/10. O livro lança a
  partir de 30/10 (29/10 fica dentro do ajuste).
- (versão anterior, substituída:) `ajuste = saldo real no fim de 28/10 − saldo do ERP considerando só o que
  é anterior ao corte`. Lança 1 `Transaction` "Ajuste de caixa — saldo real em 28/10" (CREDIT ou DEBIT) com
  categoria Ajuste de caixa, datado 28/10.
- Saldos reais do fim de 28/10: Itaú R$ 99.446,36 (linha "SALDO TOTAL DISPONÍVEL DIA" 28/out); Asaas: saldo do
  extrato no fim de 28/10 (campo `balance` do último lançamento ≤ 28/10); Inter: a obter (Karlão informou
  R$ 1.884,21 em 29/10 ~11h); cartão Itaú: fatura aberta na data.
- Lançamentos que o ERP já fez HOJE por dinheiro que caiu antes do corte (conciliações de 29/10 com data
  anterior) contam como passado. A partir do corte, cada linha do extrato com data ≥ 29/10 entra pela regra 5.1.

### 5.7 Rotina diária (07:45, seg–sex, já existe)
Ordem: Itaú (extrato + detalhe) → Asaas (extrato) → Inter → cartões → casar AR (já existe: PIX, PIX QRS, Rede,
Asaas) → **livro-razão** (5.1–5.5) → conferência de saldo por conta (ERP × banco; diferença ≠ 0 = alerta
vermelho no resumo) → pendências novas no `pendencias.md` → resumo 18:15.

### 5.8 Relatórios
- Diário (resumo 18:15): por conta — entradas, saídas, saldo real × ERP; "de onde veio" (OS/cliente) e "para
  onde foi" (categoria); lista "a classificar"; alertas.
- Mensal: entradas e saídas por categoria (DRE/fluxo de caixa do ERP alimentados pelos lançamentos
  categorizados). O construtor verifica se os relatórios existentes já leem `Transaction` por categoria; se não,
  ajusta.

## 6. Restrições
- Bancos só com acesso de consulta. Itaú: Chrome próprio porta 9340 (nunca a 9333 da rotina). Asaas: só pelo
  servidor do ERP. Credenciais em `rotina/<banco>/*.env`, fora do git, nunca impressas.
- Nunca importar OFX no ERP (dedup só por FITID → saldo em dobro).
- Publicação do ERP: só `main`, tag de restauração antes, avisar o Karlão, sem rajada.
- Testes antes do código (vitest no ERP; `node --test` na rotina); simulação (`--simular`) antes de gravar.

## 7. Decisões finais e pendências
- **Separar as compras do cartão Inter 1090 (IMP): opção B (Karlão 29/10: "vamos de b, no futuro vou pedir um
  cartão só para imprimitech").** Uma vez por mês o Karlão baixa o PDF da fatura do Inter pelo app (o PDF separa
  por cartão) e salva no **Google Drive**, pasta `Faturas Inter` (Karlão: "sincronizamos no google drive é
  melhor"; no PC: `G:\Meu Drive\Faturas Inter`). A
  rotina detecta o PDF novo, lê as compras por cartão e reclassifica as do 1090 para "a receber da IMP". Até o PDF
  chegar, as compras da fatura Inter ficam lançadas como "a classificar — cartão Inter". Quando existir o cartão
  próprio da IMP, essa etapa some.
- Pendente: ativar no Inter uma integração de API com escopo de **extrato** (gera certificado e pede aprovação no
  app) para a conta Inter dispensar login — só com OK do Karlão.

## 8. Deixado ao construtor
- Modelagem exata da conta-cartão (novo `account_type` ou convenção), tabela de regras de classificação, campo de
  categoria no `Transaction` (se não houver) e vínculo linha↔AR/AP.
- Chave estável das linhas do Itaú que não têm ID (ver 5.1).
- Ordem de implementação; sugestão: (1) corte + ajuste de caixa nas 3 contas; (2) livro-razão Itaú + Asaas;
  (3) categorias/regras e "a classificar"; (4) cartão Itaú; (5) Inter (conta e cartão); (6) relatórios.
