# Categorização assistida do livro — todo lançamento do banco com categoria, todo dia

**Data:** 30/10/2026 · **Pedido:** Karlão · **Base:** livro-razão fase 1 (espelho do banco, ajuste de caixa feito em 30/10)

## Por quê

Karlão, 30/10: *"a partir de agora todos os débitos e créditos precisam ser categorizados diariamente e assim o ERP refletir o fluxo de caixa... tudo que entra e sai das contas será categorizado... eu ajudo caso não saiba de onde vem o lançamento e que tipo de categoria é... uma varredura de manhã, na hora do almoço e à noite, até a skill ficar robusta e trabalhar sozinha."*

Desde 30/10 o livro lança toda linha do Itaú e do Asaas no ERP (07:00, 12:30, 18:30). O que as regras não reconhecem cai em **"A classificar"** (saídas) ou **"Receita a identificar"** (entradas). Este projeto fecha o ciclo: a rotina pergunta ao Karlão o que não sabe, aprende com a resposta e passa a perguntar cada vez menos.

## Objetivos

1. Toda linha do banco lançada pelo livro termina o dia com uma categoria real (não "A classificar" / "Receita a identificar"), salvo o que o Karlão também não souber.
2. Em cada rodada (07:00, 12:30, 18:30), depois do livro, a rotina manda **uma** mensagem no WhatsApp "(você)" com os lançamentos novos sem categoria, numerados, cada um com um palpite quando houver.
3. O Karlão responde por onde for mais prático — **WhatsApp, chat com o Claude ou direto na tela do ERP** (Karlão: "ambas as opções"). As três formas têm o mesmo efeito.
4. **Cada resposta vira regra**: na próxima vez que a mesma origem aparecer, o livro já lança com a categoria certa, sem perguntar.
5. Depois de aplicar, a rotina confirma no WhatsApp o que mudou (lançamento → categoria, e a regra criada).
6. O fluxo de caixa e o DRE do ERP mostram entradas e saídas por categoria com esses lançamentos.

## Não-objetivos

- Importar OFX (regra do Karlão: nunca).
- Inter automático (login por QR no app; fica para depois). O ajuste do Inter já foi feito; sem livro do Inter por enquanto.
- Mudar o login do Itaú (já resolvido em 30/10 com o login manual nas três rodadas).
- Compras no cartão de crédito compra a compra (conta-cartão — fase seguinte; ver 4b).

## Anti-objetivos (falha mesmo que "funcione")

- A rotina **inventar** categoria: palpite só vale depois de confirmado; sem regra e sem resposta, fica "A classificar".
- Perguntar de novo o que **já foi respondido** ou que uma regra já cobre.
- Encher o WhatsApp: no máximo uma pergunta por rodada; itens novos primeiro, depois os ainda sem resposta (marcados "ainda sem resposta").
- Regra larga demais que categoriza errado em massa (ex.: padrão "PIX" ou "PIX ENVIADO" casaria com tudo).
- A mensagem confundir a rotina de orçamentos, que lê as respostas do Karlão no mesmo "(você)": toda mensagem da rotina começa com **"Varredura —"**, e a leitura de respostas de categoria só considera respostas posteriores a uma pergunta de categoria.

## Como funciona

### 1. Pergunta (fim de cada rodada da conciliação)
Depois do `livro.cjs`, um passo novo junta, nas contas do livro, as transações do livro com categoria "A classificar" ou "Receita a identificar" ainda não resolvidas e manda:

```
Varredura — Categorias 12:30 (4 sem categoria)
1) 30/10 saída R$ 1.000,00 Itaú "PIX ENVIADO ELVIS FERREIRA" — palpite: Salários?
2) 30/10 saída R$ 89,90 Asaas "Transação via Pix ... VIVO" — palpite: Telefone e Internet?
3) 30/10 entrada R$ 150,00 Itaú "PIX RECEBIDO MARIA S" — ?
4) 29/10 saída R$ 32,00 Itaú "TAR PACOTE" — palpite: Despesas Bancárias?
Responda começando com cat: "cat 1 ok, 2 ok, 3 cliente OS 63010, 4 despesas bancárias". "?" = não sei (fica para depois).
```

- Palpite = categoria de uma resposta anterior parecida ou nome óbvio no texto do banco. Palpite nunca é aplicado sem "ok".
- Lista longa: até ~15 por mensagem; o resto vai na rodada seguinte.

### 2. Resposta
- **WhatsApp:** na rodada seguinte (e numa leitura curta a cada passada da varredura, se for barato), a rotina lê as respostas do "(você)" posteriores à última pergunta (`ler-voce.cjs`) e interpreta "número + categoria / ok / ?".
- **Chat:** o Claude aplica do mesmo jeito.
- **Tela do ERP (Extrato):** hoje a edição rápida só funciona para contas a receber/pagar. Passa a abrir também para os lançamentos do livro, com a lista de categorias e uma caixa **"aplicar também aos próximos iguais"** (cria a regra). Usa a rota que já existe: `PATCH /api/financeiro/livro/transacoes/[id]` `{category_id, criar_regra?: {pattern, direction}}`.

### 3. Aplicação e aprendizado
- Cada resposta → `PATCH /livro/transacoes/[id]` com a categoria e `criar_regra` com um **padrão** tirado do texto do banco: sem prefixos genéricos ("PIX ENVIADO", "PIX RECEBIDO", "Transação via Pix com chave para", datas, números de documento), ficando o nome/empresa (ex.: "ELVIS FERREIRA") + direção (entrada/saída).
- O padrão tem tamanho mínimo e nunca pode ser só uma palavra genérica (lista de proibidos).
- Categoria respondida que não existe → cria (despesa se saída, receita se entrada) e avisa.
- Confirmação no WhatsApp: "Varredura — Categorias aplicadas: 1 → Salários (regra 'ELVIS FERREIRA'), 2 → Telefone e Internet (regra 'VIVO')...".
- Lançamentos antigos ainda "A classificar" que casam com a regra nova também são recategorizados (mesma resposta, sem perguntar de novo).

### 4. Receita a identificar (entradas)
Muitas entradas são pagamento de OS: a conciliação (PIX/cartão/Asaas) liquida a conta a receber; quando o livro lançou a linha antes da baixa, a baixa passa a ligar os dois (4c), e o lançamento sai de "Receita a identificar". Para não perguntar o que a conciliação vai resolver sozinha, entrada só é perguntada se **continuar sem vínculo depois da rodada seguinte**; e a conciliação, quando liquida uma OS por uma linha do banco, já recategoriza o lançamento correspondente para a receita de serviços.

### 4b. Saídas (débitos) — Karlão: "lembre-se também dos débitos, quando a gente compra algo ou paga algo"
- **Toda saída** passa pelo mesmo ciclo (regra → senão pergunta → resposta vira regra).
- **Pagamento de conta já cadastrada em contas a pagar** (boleto de fornecedor, imposto, aluguel...): a rotina procura conta a pagar em aberto com o mesmo valor, vencimento perto (±5 dias) e nome parecido. Achando, a pergunta já vem com o palpite — "é a conta a pagar 'DARF Simples' venc. 20/10?" — e, com "ok", **dá baixa na conta a pagar usando o lançamento do livro daquela linha** (sem criar um segundo débito) e o lançamento fica com a categoria da conta a pagar. Por enquanto sempre com o "ok" do Karlão; baixa automática só se ele pedir depois.
- **Compra** (peças, material, combustível, frete...): a resposta pode dizer o que foi ("2 peças, cabeça L3150 do fornecedor X"); a categoria vai no lançamento e o texto vira observação dele.
- **Cartões de crédito** (Itaú final 5290, cartões Inter): no extrato da conta só aparece o pagamento da fatura, não cada compra. Lançar compra a compra exige a conta-cartão prevista no desenho de 29/10 — **fase seguinte**. Até lá o pagamento da fatura entra como "Transferência entre contas" (regra do Inter já existe; a do Itaú vem pela pergunta).

### 4c. Mudanças no ERP que este projeto inclui
- **Baixa que aproveita o lançamento do livro** (era o Plano 2 item 1): dar baixa numa conta a receber ou a pagar cuja linha do banco o livro já lançou **liga** a conta àquele lançamento (troca a categoria, guarda o vínculo) em vez de criar outro crédito/débito — senão o dinheiro conta 2x no saldo. Vale para a baixa feita pela rotina e para a feita por alguém na tela do ERP.
- **Edição rápida dos lançamentos do livro na tela de Extrato**, com "aplicar também aos próximos iguais".
- Categoria nova "Receita de serviços".
- Deploy como sempre: só `main`, tag antes, aviso ao Karlão, no máximo 1 a cada 2 h.

### 5. Acompanhamento ("até ficar robusta")
O aviso das 18:30 passa a trazer: quantos lançamentos do dia entraram já categorizados pelas regras × quantos precisaram de pergunta, e o total do dia por categoria (entradas e saídas). Quando a parte perguntada ficar pequena por vários dias seguidos, o Karlão decide voltar para menos rodadas.

## Restrições

- Rotina fora do git em `Downloads\dia a dia\rotina\itau` (padrão atual); ERP em `C:\dev\pontual-erp` (deploy só da `main`, tag antes, no máximo 1 deploy a cada 2 h, avisar antes).
- Todo script que mexe no ERP ou no navegador usa a trava `passada.lock` (`com_lock.cjs`).
- WhatsApp só pelo Chrome da rotina (9333) e só na conversa "(você)"; mensagens começam com "Varredura —".
- Nada de credenciais em log; nada manual além das respostas do Karlão.
- Categorias atuais: Ajuste de caixa, A classificar, Transferência entre contas, Transferência entre empresas, Receita a identificar, Rendimentos, Anúncios, Sistemas e Assinaturas, Telefone e Internet, Energia, Despesas Bancárias, Peças e Fornecedores, Impostos, Retirada Socios (+ as que já existiam no ERP).

## Decisões tomadas pelo Claude (o Karlão confere)

1. **Quem lê a resposta:** um `claude -p` (como na transcrição de comprovantes), preso à lista de categorias existentes: casa a palavra do Karlão com a categoria mais próxima ("despesas bancárias", "bancaria" → Despesas Bancárias). Categoria **nova** só é criada se não houver nenhuma parecida, e a confirmação diz "categoria nova criada: X" (o Karlão desfaz se errou). Resposta que não dá para entender volta na confirmação como "não entendi o 3".
2. **"Receita de serviços":** categoria nova de receita, para entrada que é pagamento de OS. Quando a conciliação liquida uma OS por uma linha do banco, a própria rotina recategoriza o lançamento do livro daquela linha para "Receita de serviços" (rota que já existe, sem deploy do ERP). Entrada só é perguntada se ainda estiver em "Receita a identificar" na **rodada seguinte** à que a lançou.
3. **"?" e sem resposta:** "?" tira o item das perguntas daquele dia; ele volta numa lista "ainda sem categoria" na sexta 18:30. Sem resposta, o item reaparece nas rodadas seguintes como "ainda sem resposta", depois dos itens novos, dentro do limite de 15.
4. **Relatórios:** entra no trabalho conferir se o fluxo de caixa e o DRE do ERP leem os lançamentos do livro, e corrigir se não lerem. "Ajuste de caixa" e "Transferência entre contas/empresas" ficam fora do DRE (não são receita nem despesa).
5. **Retroativo e alcance da regra:** a regra nova só recategoriza lançamentos que ainda estão em "A classificar" ou "Receita a identificar" (nunca um já categorizado) e vale para todas as contas (o mesmo fornecedor pode aparecer no Itaú e no Asaas).

## Resposta do Karlão (30/10)

- Entrada respondida como pagamento de OS ("3 cliente OS 63010") → categoriza como Receita de serviços **e dá baixa na conta a receber dessa OS** se estiver em aberto (Karlão: "sim"). A resposta dele é o OK daquela baixa; valem as mesmas travas da conciliação (conta a receber RECEBIDA e não conciliada da conta certa, valor confere com a linha do banco, linha/ID do banco não usado antes, sem crédito igual perto da data; diferença de centavos vai na nota da OS). Se a trava barrar, não baixa e avisa na confirmação. A baixa liga o crédito ao lançamento do livro daquela linha (sem contar o dinheiro 2x).

## O que fica para quem constrói

- Formato exato das mensagens e do texto de confirmação (seguindo o exemplo acima).
- Onde guardar o estado "perguntado em / respondido" (arquivo da rotina ou campo no ERP).
- A lista de prefixos genéricos e palavras proibidas do normalizador de padrão.
- Se a leitura de respostas roda também nas passadas da varredura ou só nas três rodadas.
