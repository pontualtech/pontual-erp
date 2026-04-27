// Adiciona ao prompt da Ana uma regra explicita pra usar [CONTEXTO DO CLIENTE]
// que o backend ja envia. Sem essa regra, Ana ignorava o contexto e tratava
// cliente recorrente como novo.
async function main() {
  const loginResp = await fetch('https://dify.pontualtech.work/console/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'karlao@outlook.com', password: Buffer.from('Lustos@22').toString('base64') }),
  })
  const setCookies = loginResp.headers.getSetCookie()
  const token = setCookies.find(c => c.includes('__Host-access_token=')).match(/=([^;]+)/)[1]
  const csrf = setCookies.find(c => c.includes('__Host-csrf_token=')).match(/=([^;]+)/)[1]
  const h = {
    'Authorization': 'Bearer ' + token,
    'Cookie': '__Host-access_token=' + token + '; __Host-csrf_token=' + csrf,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  }

  const appId = '0cb2153a-562d-49fb-9f9d-0d81ed0c7a8d'
  const appResp = await fetch('https://dify.pontualtech.work/console/api/apps/' + appId, { headers: h })
  const app = await appResp.json()
  const mc = app.model_config
  let prompt = mc.pre_prompt

  const marker = 'CONTEXTO DO CLIENTE [AUDITORIA]'
  if (prompt.includes(marker)) {
    console.log('Already has context rule. Skipping.')
    return
  }

  const newRule = [
    '* ' + marker + ':',
    '  Em algumas mensagens voce recebera um bloco "[CONTEXTO DO CLIENTE: Nome: ..., Telefone: ..., OS ativas: ...]" depois da mensagem do cliente.',
    '  Quando esse bloco aparecer:',
    '    - O cliente JA esta no nosso cadastro. Trate-o pelo NOME na saudacao: "Olá, [primeiro_nome]! 😊"',
    '    - Se houver OS listadas, mencione brevemente em UMA linha: "Vejo que voce ja tem [N] OS em andamento aqui com a gente."',
    '    - NAO peca dados que ja temos (nome, telefone). Continue para o equipamento NOVO.',
    '    - Se for um equipamento novo (que ele quer abrir mais uma OS), continue o fluxo normal: marca/modelo/defeito/coleta-ou-loja.',
    '  Quando NAO houver esse bloco, trate como cliente NOVO e siga fluxo padrao.',
    '',
  ].join('\n')

  // Insert after the "PRIMEIRA MENSAGEM" line (it always starts a new bullet block)
  if (prompt.includes('* PRIMEIRA MENSAGEM:')) {
    prompt = prompt.replace(/(\* PRIMEIRA MENSAGEM:[^\n]*\n)/, '$1' + newRule)
  } else {
    // Fallback: append at the end
    prompt = prompt + '\n' + newRule
  }

  if (!prompt.includes(marker)) {
    console.error('Insertion failed.')
    process.exit(1)
  }

  mc.pre_prompt = prompt
  const upd = await fetch('https://dify.pontualtech.work/console/api/apps/' + appId + '/model-config', {
    method: 'POST', headers: h, body: JSON.stringify(mc),
  })
  console.log('Update status:', upd.status, 'len=' + prompt.length)
}
main().catch(e => { console.error(e.message); process.exit(1) })
