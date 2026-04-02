const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

async function main() {
  const companyId = 'pontualtech-001'

  // 1. Config CNAB — dados do Banco Inter
  const cnabSettings = [
    { key: 'cnab.cnpj', value: '32772178000147' },
    { key: 'cnab.razao_social', value: 'PONTUAL TECH SERVICOS DE INFORMATICA LTDA' },
    { key: 'cnab.agencia', value: '0001' },
    { key: 'cnab.conta', value: '4025073-3' },
    { key: 'cnab.carteira', value: '112' },
    { key: 'cnab.sequencial', value: '0' },
  ]

  for (const s of cnabSettings) {
    await p.setting.upsert({
      where: { company_id_key: { company_id: companyId, key: s.key } },
      create: { company_id: companyId, key: s.key, value: s.value, type: 'string' },
      update: { value: s.value },
    })
    console.log('  Config:', s.key, '=', s.value)
  }

  // 2. Formas de pagamento
  const formas = [
    { name: 'Dinheiro', icon: '💵' },
    { name: 'PIX', icon: '📱' },
    { name: 'Cartão Crédito', icon: '💳' },
    { name: 'Cartão Débito', icon: '💳' },
    { name: 'Boleto', icon: '🏦' },
    { name: 'Transferência', icon: '🏛️' },
  ]

  for (const f of formas) {
    const existing = await p.$queryRawUnsafe(
      `SELECT id FROM settings WHERE company_id = '${companyId}' AND key LIKE 'forma_pgto.%' AND value LIKE '%${f.name}%' LIMIT 1`
    )
    if (existing.length === 0) {
      await p.setting.create({
        data: {
          company_id: companyId,
          key: `forma_pgto.${crypto.randomUUID()}`,
          value: JSON.stringify({ name: f.name, icon: f.icon, active: true }),
          type: 'json',
        },
      })
      console.log('  Forma pgto:', f.icon, f.name)
    } else {
      console.log('  Forma pgto:', f.icon, f.name, '(já existe)')
    }
  }

  // 3. Conta bancária — Banco Inter
  const existingAccount = await p.$queryRawUnsafe(
    `SELECT id FROM accounts WHERE company_id = '${companyId}' AND bank_name LIKE '%Inter%' LIMIT 1`
  )
  let accountId
  if (existingAccount.length === 0) {
    const account = await p.account.create({
      data: {
        company_id: companyId,
        name: 'Banco Inter — Conta Corrente',
        account_type: 'CHECKING',
        bank_name: 'Banco Inter',
        agency: '0001',
        account_number: '4025073-3',
        initial_balance: 0,
        current_balance: 0,
        is_active: true,
      },
    })
    accountId = account.id
    console.log('  Conta bancária criada:', account.name, '| ID:', account.id)
  } else {
    accountId = existingAccount[0].id
    console.log('  Conta bancária já existe:', accountId)
  }

  // Vincular conta ao CNAB
  await p.setting.upsert({
    where: { company_id_key: { company_id: companyId, key: 'cnab.account_id' } },
    create: { company_id: companyId, key: 'cnab.account_id', value: accountId, type: 'string' },
    update: { value: accountId },
  })
  console.log('  cnab.account_id =', accountId)

  console.log('')
  console.log('=== SEED COMPLETO! ===')
  console.log('Agora voce pode:')
  console.log('1. Abrir uma OS > Mudar status para "Entregue" > Selecionar forma de pagamento')
  console.log('2. Ir em Financeiro > CNAB > Gerar Remessa')
  console.log('3. O arquivo .REM sera gerado com os boletos pendentes')

  await p.$disconnect()
}
main().catch(e => { console.error(e.message); process.exit(1) })
