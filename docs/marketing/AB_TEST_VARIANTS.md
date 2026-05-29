# Variantes de Copy pra A/B Testing — Bot Isca PontualTech

**Status:** RASCUNHO — pra usar quando atingir ~100 leads/semana e fizer A/B test estatisticamente válido.

**Como aplicar:** UPDATE setting `bot.followup.msg_3` (ou criar lógica de rotação semanal/diária).

---

## msg_3 — Isca digital (variante atual em prod)

### V1 — "Presente útil" (PRODUÇÃO)
```
Ok, vou parar de incomodar 😊 Mas se quiser ficar com um presente
útil, posso te enviar por email um *Checklist Mensal de Manutenção*
gratuito.

Funciona pra qualquer impressora — jato, laser ou térmica — e ajuda
muito sua impressora durar mais.

Quer? Manda seu melhor email 📋
```
**Tom:** humilde, sem pressão, foco em valor gratuito.
**Risco:** baixo. Default seguro.

### V2 — "Caso de dor" (testar)
```
Sei que tá ocupado. Antes de eu sumir, te passo uma dica que pode
te economizar grana: a maioria das impressoras quebra por 3 hábitos
simples que pouca gente sabe.

Posso te enviar o checklist completo por email? São 5 min de leitura.

Manda seu melhor email pra eu te mandar 📋
```
**Tom:** consultivo, "como amigo"
**Hipótese:** "economizar grana" pode engajar mais que "checklist"

### V3 — "Urgência leve" (testar)
```
Tá bom, vou parar de incomodar 😊 Última coisa: hoje à noite vou
enviar um pacote de dicas pra alguns clientes — posso te incluir?

São 8 cuidados simples que evitam 80% dos defeitos de impressora.
Por email.

Me passa seu melhor email se quiser receber 📋
```
**Tom:** quase scarcity (mas honesto — você manda mesmo)
**Hipótese:** sensação de "fazer parte" aumenta conversão
**Risco médio:** se cliente não receber rápido, parece mentira

### V4 — "Aposta no humor" (testar)
```
Beleza, paro de te perturbar! 😅

Mas antes, deixa eu te dar de presente um checklist que NÃO é
chato — promete: 8 dicas pra impressora durar mais (algumas você
nem imagina).

Manda seu email que envio na hora 📋
```
**Tom:** descontraído, brinca com "ser chato"
**Hipótese:** humor quebra resistência

---

## Email D0 subject — Variantes

### V1 — "Seu checklist está aqui" (PRODUÇÃO)
`Seu checklist de manutenção (e quem somos)`

**Open rate esperado:** 35-45% (subject pessoal + valor explícito)

### V2 — Curiosidade
`O erro #3 do checklist surpreende todo mundo`

**Hipótese:** curiosidade gap aumenta open rate. Mas pode soar clickbait.

### V3 — Direto
`📋 Checklist + apresentação PontualTech`

**Hipótese:** emoji + clareza. Conservador.

### V4 — Pergunta
`Pediu o checklist, certo?`

**Hipótese:** pergunta cria reciprocidade (resposta mental: "sim, pedi"). Cuidado: parece "tem certeza?" se enviar pra muita gente cold.

---

## CTA do email — Variantes

### V1 — "Chamar no WhatsApp" (PRODUÇÃO)
`💬 Chamar no WhatsApp`

### V2 — "Falar com um técnico"
`💬 Falar com um técnico (resposta em 10 min)`

### V3 — "Garantir prioridade"
`🚀 Garantir atendimento prioritário`

**Tradeoff:** V2 dá expectativa específica (resposta em 10min — precisa cumprir). V3 sugere "vantagem" mas pode soar exagero.

---

## Estratégia de rollout A/B

1. **Esperar até ter ≥100 leads/semana** (volume mínimo pra significância)
2. **Variante por dia da semana**:
   - Seg/Qua/Sex: V1 (controle)
   - Ter/Qui/Sab: V2/V3/V4 rotativo
3. **Métricas a comparar**:
   - Taxa de aceite da isca (% que respondeu com email vs ignorou)
   - Open rate email D0
   - Reactivation rate D60+
4. **Decisão**: rodar 2 semanas, vencedor vira default

## Implementação técnica (futuro)

Setting DB pode evoluir pra suportar A/B:
```
bot.followup.msg_3_variants = JSON.stringify([
  { weight: 0.5, text: "V1..." },
  { weight: 0.25, text: "V2..." },
  { weight: 0.25, text: "V3..." },
])
```
Cron sortea variant por weight, grava qual usou em `botConversation.data.isca_variant` pra atribuição.

**Não implementar agora** — premature. Só vale quando volume justifica.

---

## Memory linked

- [[project_isca_bot_abandono]]
- [[feedback_isca_msg3_estrategia]]
