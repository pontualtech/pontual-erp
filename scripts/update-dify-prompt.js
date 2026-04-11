// Fix: OS status → portal + suporte fallback
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

  // Replace the "Ja e cliente" routing rule
  prompt = prompt.replace(
    /\* Ja e cliente \(status de OS.*?\[ENCERRAR_CONVERSA\]\./,
    '* Ja e cliente (status de OS, orcamento, aprovacao, acompanhamento): Redirecione ao portal: portal.pontualtech.com.br/portal/pontualtech/login e diga que caso nao consiga acessar (cliente antigo sem cadastro no portal), pode falar com a equipe pelo WhatsApp: wa.me/551126263841. ENCERRE com [ENCERRAR_CONVERSA].'
  );

  console.log('Has "caso nao consiga":', prompt.includes('caso nao consiga'));

  mc.pre_prompt = prompt;
  const updateResp = await fetch('https://dify.pontualtech.work/console/api/apps/0cb2153a-562d-49fb-9f9d-0d81ed0c7a8d/model-config', {
    method: 'POST', headers: h, body: JSON.stringify(mc)
  });
  console.log('Update:', updateResp.status, await updateResp.text());
}
main();
