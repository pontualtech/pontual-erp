// Add rule: non-sales queries redirect to suporte
async function main() {
  const loginResp = await fetch('https://dify.pontualtech.work/console/api/login', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({email:'karlao@outlook.com', password: Buffer.from('Lustos@22').toString('base64')})
  });
  const setCookies = loginResp.headers.getSetCookie();
  const token = setCookies.find(c=>c.includes('__Host-access_token=')).match(/=([^;]+)/)[1];
  const csrf = setCookies.find(c=>c.includes('__Host-csrf_token=')).match(/=([^;]+)/)[1];
  const h = { 'Authorization': 'Bearer ' + token, 'Cookie': '__Host-access_token=' + token + '; __Host-csrf_token=' + csrf, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' };

  const appResp = await fetch('https://dify.pontualtech.work/console/api/apps/0cb2153a-562d-49fb-9f9d-0d81ed0c7a8d', {headers: h});
  const app = await appResp.json();
  const mc = app.model_config;
  let prompt = mc.pre_prompt;

  // Update section 4 (ROTEAMENTO) to be more explicit about redirecting non-sales
  const s4idx = prompt.indexOf('## 4. ROTEAMENTO');
  const s5idx = prompt.indexOf('## 5.');

  if (s4idx >= 0 && s5idx > s4idx) {
    const newSection4 = `## 4. ROTEAMENTO — PRIMEIRA PRIORIDADE

Voce atua EXCLUSIVAMENTE no canal de VENDAS e NOVOS CLIENTES. Qualquer assunto fora disso, redirecione IMEDIATAMENTE.

Identifique o cenario e aja:

* Ja e cliente (status de OS, orcamento, aprovacao, acompanhamento): Redirecione ao portal: portal.pontualtech.com.br/portal/pontualtech/login e ENCERRE com [ENCERRAR_CONVERSA].

* Reclamacao, Garantia, Suporte Tecnico, Financeiro, Administrativo: Acolha brevemente e REDIRECIONE ao WhatsApp do suporte/adm: wa.me/551126263841. NUNCA tente resolver. NUNCA de informacoes tecnicas. ENCERRE com [ENCERRAR_CONVERSA].

* Novo Cliente (Vendas): Inicie a qualificacao normalmente.

* Duvida complexa B2B ou que voce nao sabe resolver: Use [TRANSFERIR_HUMANO].

REGRA ABSOLUTA: Se o assunto NAO for sobre COMPRAR/CONSERTAR um equipamento NOVO, redirecione ao suporte via wa.me/551126263841 e ENCERRE. Em hipotese alguma tente resolver questoes de suporte, garantia, financeiro ou administrativo.

---

`;
    prompt = prompt.slice(0, s4idx) + newSection4 + prompt.slice(s5idx);
  }

  console.log('Has EXCLUSIVAMENTE:', prompt.includes('EXCLUSIVAMENTE'));
  console.log('Has hipotese alguma:', prompt.includes('hipotese alguma'));
  console.log('Length:', prompt.length);

  mc.pre_prompt = prompt;
  const updateResp = await fetch('https://dify.pontualtech.work/console/api/apps/0cb2153a-562d-49fb-9f9d-0d81ed0c7a8d/model-config', {
    method: 'POST', headers: h, body: JSON.stringify(mc)
  });
  console.log('Update:', updateResp.status, await updateResp.text());
}
main();
