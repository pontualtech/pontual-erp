// Update Ana's prompt in Dify
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

  const s6idx = prompt.indexOf('## 6. FECHAMENTO');
  const s7idx = prompt.indexOf('## 7. GATILHOS');

  const newSection6 = `## 6. FECHAMENTO E ABERTURA DE OS

REGRA DE OURO: So peca confirmacao quando tiver TODOS os 7 dados obrigatorios:
1. Nome completo
2. CPF ou CNPJ
3. Endereco completo com CEP
4. E-mail
5. Telefone de contato
6. Marca e modelo do equipamento
7. Descricao do defeito

Se o cliente mandou varios dados de uma vez, EXTRAIA e ANOTE todos. So peca o que REALMENTE falta. NUNCA repita algo que o cliente ja informou.

Se o telefone estiver faltando, pergunte: "E qual o melhor telefone pra nossa equipe confirmar o horario da retirada?"

Quando tiver TUDO, confirme de forma NATURAL, como uma conversa entre amigos. NAO use formato de formulario. Exemplo:
"Deixa eu ver se peguei tudo certo... Carlos Lustosa, CPF terminando em 809, endereco na Rua Mooca 4179, Epson L355 que nao liga, contato por karlao@outlook.com e 12 99736-1519. Certinho tudo isso?"

IMPORTANTE: SOMENTE apos o cliente confirmar, inclua no FINAL da sua resposta:

[VHSYS_DATA]{"nome":"[nome]","cpf_cnpj":"[cpf/cnpj]","email":"[email]","cep":"[cep]","telefone":"[telefone]","endereco":"[endereco completo]","marca":"[marca]","modelo":"[modelo]","defeito":"[defeito]","equipamento":"[marca] [modelo]"}[/VHSYS_DATA]
[ABRIR_OS]

Apos incluir as tags, diga algo natural como: "Show! To abrindo sua OS agora... A equipe ja vai entrar em contato pra combinar o melhor horario da coleta!"

NAO diga "OS aberta com sucesso" — o sistema envia a confirmacao oficial automaticamente.

`;

  prompt = prompt.slice(0, s6idx) + newSection6 + prompt.slice(s7idx);
  mc.pre_prompt = prompt;

  const updateResp = await fetch('https://dify.pontualtech.work/console/api/apps/0cb2153a-562d-49fb-9f9d-0d81ed0c7a8d/model-config', {
    method: 'POST', headers: h, body: JSON.stringify(mc)
  });
  console.log('Update:', updateResp.status);
  const result = await updateResp.text();
  console.log('Result:', result.slice(0,100));
}
main();
