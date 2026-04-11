// Update Ana's prompt in Dify — fix portal URL, WhatsApp link, and outdated references
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

  console.log('Original length:', prompt.length);

  // 1. Replace ALL old portal URLs
  prompt = prompt.replace(/pontualtech\.com\.br\/#consulta-os/g, 'portal.pontualtech.com.br/portal/pontualtech/login');
  prompt = prompt.replace(/pontualtech\.com\.br\/\#consulta-os/g, 'portal.pontualtech.com.br/portal/pontualtech/login');

  // 2. Replace phone numbers with WhatsApp links
  prompt = prompt.replace(/\(11\) 2626-3841/g, 'wa.me/551126263841');
  prompt = prompt.replace(/551126263841/g, '551126263841');

  // 3. Replace wa.me/551126263841 references to ensure format is correct
  // Already correct format

  // 4. Replace any suporte phone references with WhatsApp link format
  prompt = prompt.replace(/nosso suporte esta a disposicao:\s*📞.*?551126263841/gs,
    'nosso suporte via WhatsApp: wa.me/551126263841');

  // 5. Fix section 4 routing — update portal reference
  prompt = prompt.replace(
    /Encaminhe para o portal pontualtech\.com\.br\/#consulta-os/g,
    'Encaminhe para o portal: portal.pontualtech.com.br/portal/pontualtech/login'
  );
  prompt = prompt.replace(
    /Encaminhe para o portal portal\.pontualtech\.com\.br\/portal\/pontualtech\/login/g,
    'Encaminhe para o portal: portal.pontualtech.com.br/portal/pontualtech/login'
  );

  // 6. Fix suporte WhatsApp reference — use link instead of phone
  prompt = prompt.replace(
    /mande o link do suporte \(wa\.me\/551126263841\)/g,
    'mande o link do suporte: wa.me/551126263841'
  );

  console.log('Updated length:', prompt.length);
  console.log('Has old portal:', prompt.includes('pontualtech.com.br/#consulta'));
  console.log('Has new portal:', prompt.includes('portal.pontualtech.com.br'));
  console.log('Has phone (11) 2626:', prompt.includes('(11) 2626'));
  console.log('Has wa.me link:', prompt.includes('wa.me/551126263841'));

  mc.pre_prompt = prompt;

  const updateResp = await fetch('https://dify.pontualtech.work/console/api/apps/0cb2153a-562d-49fb-9f9d-0d81ed0c7a8d/model-config', {
    method: 'POST', headers: h, body: JSON.stringify(mc)
  });
  console.log('Update:', updateResp.status);
  const result = await updateResp.text();
  console.log('Result:', result.slice(0,100));
}
main();
