const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

async function main() {
  // Contas a receber pendentes
  const pendentes = await p.$queryRawUnsafe(`
    SELECT ar.id, ar.description, ar.total_amount, ar.status, ar.boleto_url, ar.due_date,
           c.legal_name, c.document_number
    FROM accounts_receivable ar
    LEFT JOIN customers c ON c.id = ar.customer_id
    WHERE ar.status = 'PENDENTE' AND ar.deleted_at IS NULL
    ORDER BY ar.due_date ASC
    LIMIT 20
  `)
  console.log('=== CONTAS A RECEBER PENDENTES ===')
  console.log('Total:', pendentes.length)
  for (const r of pendentes) {
    console.log('  ID:', r.id.substring(0,15))
    console.log('  Desc:', (r.description || '').substring(0, 50))
    console.log('  Total: R$', (Number(r.total_amount)/100).toFixed(2))
    console.log('  Boleto:', r.boleto_url || 'NULL (disponivel para CNAB)')
    console.log('  Cliente:', r.legal_name || 'SEM CLIENTE')
    console.log('  Doc:', r.document_number || '** SEM CPF/CNPJ **')
    console.log('  Venc:', r.due_date)
    console.log('')
  }

  // Config CNAB
  const cfg = await p.$queryRawUnsafe(`
    SELECT key, value FROM settings WHERE key LIKE 'cnab.%' LIMIT 20
  `)
  console.log('=== CONFIG CNAB ===')
  if (cfg.length === 0) console.log('** NENHUMA CONFIG CNAB! Precisa configurar em Financeiro > CNAB > Configuracao **')
  for (const s of cfg) console.log(' ', s.key, '=', s.value)

  // Formas de pagamento
  const pgtos = await p.$queryRawUnsafe(`
    SELECT key, value FROM settings WHERE key LIKE 'forma_pgto.%' LIMIT 20
  `)
  console.log('')
  console.log('=== FORMAS DE PAGAMENTO ===')
  if (pgtos.length === 0) console.log('** NENHUMA FORMA DE PAGAMENTO! Precisa cadastrar em Financeiro > Formas de Pagamento **')
  for (const s of pgtos) {
    try { const v = JSON.parse(s.value); console.log(' ', v.name, '|', v.icon, '| ativo:', v.active) }
    catch { console.log(' ', s.value) }
  }

  // Status com is_final
  const statuses = await p.$queryRawUnsafe(`
    SELECT id, name, is_final, module, "order" FROM module_statuses WHERE module = 'os' ORDER BY "order" ASC
  `)
  console.log('')
  console.log('=== STATUS OS ===')
  for (const s of statuses) {
    console.log(' ', s.order + '.', s.name, s.is_final ? '** FINAL **' : '')
  }

  // Contas bancárias
  const accounts = await p.$queryRawUnsafe(`SELECT id, name, bank_name FROM accounts WHERE is_active = true LIMIT 10`)
  console.log('')
  console.log('=== CONTAS BANCARIAS ===')
  if (accounts.length === 0) console.log('** NENHUMA CONTA BANCARIA! **')
  for (const a of accounts) console.log(' ', a.name, '|', a.bank_name || '-')

  await p.$disconnect()
}
main().catch(e => { console.error(e.message); process.exit(1) })
