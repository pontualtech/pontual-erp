const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()

async function main() {
  const os = await p.$queryRawUnsafe(`
    SELECT s.id, s.os_number, s.total_cost, s.payment_method, s.company_id,
           ms.name as status_name, ms.is_final,
           c.legal_name, c.document_number, c.email
    FROM service_orders s
    LEFT JOIN module_statuses ms ON ms.id = s.status_id
    LEFT JOIN customers c ON c.id = s.customer_id
    WHERE s.os_number = 53928
    LIMIT 1
  `)
  if (!os.length) { console.log('OS 53928 NAO ENCONTRADA'); return }
  const o = os[0]
  console.log('=== OS 53928 ===')
  console.log('ID:', o.id)
  console.log('Status:', o.status_name, '| is_final:', o.is_final)
  console.log('Total:', o.total_cost, 'centavos (R$', ((Number(o.total_cost)||0)/100).toFixed(2), ')')
  console.log('Payment:', o.payment_method)
  console.log('Cliente:', o.legal_name)
  console.log('CPF/CNPJ:', o.document_number)
  console.log('Email:', o.email)

  // Contas a receber
  const ars = await p.$queryRawUnsafe(`
    SELECT id, description, total_amount, status, boleto_url, pix_code, due_date, customer_id
    FROM accounts_receivable
    WHERE service_order_id = '${o.id}'
  `)
  console.log('')
  console.log('=== CONTAS A RECEBER (' + ars.length + ') ===')
  for (const ar of ars) {
    console.log('  ID:', ar.id)
    console.log('  Desc:', ar.description)
    console.log('  Total: R$', (Number(ar.total_amount)/100).toFixed(2))
    console.log('  Status:', ar.status)
    console.log('  Boleto:', ar.boleto_url || 'NULL')
    console.log('  Due:', ar.due_date)
    console.log('')
  }

  // Pendentes sem boleto para CNAB
  const pendentes = await p.$queryRawUnsafe(`
    SELECT ar.id, ar.description, ar.total_amount, c.document_number, c.legal_name
    FROM accounts_receivable ar
    LEFT JOIN customers c ON c.id = ar.customer_id
    WHERE ar.company_id = '${o.company_id}'
      AND ar.status = 'PENDENTE'
      AND ar.boleto_url IS NULL
      AND ar.deleted_at IS NULL
    ORDER BY ar.due_date ASC
    LIMIT 10
  `)
  console.log('=== PENDENTES SEM BOLETO (disponiveis para CNAB) ===')
  console.log('Total:', pendentes.length)
  for (const r of pendentes) {
    console.log('  -', r.id.substring(0,15), '| R$', (Number(r.total_amount)/100).toFixed(2), '|', (r.legal_name||'').substring(0,25), '| Doc:', r.document_number || 'SEM DOCUMENTO')
  }

  // Config CNAB
  const cfg = await p.$queryRawUnsafe(`
    SELECT key, value FROM settings WHERE company_id = '${o.company_id}' AND key LIKE 'cnab.%'
  `)
  console.log('')
  console.log('=== CONFIG CNAB ===')
  if (cfg.length === 0) console.log('** NENHUMA CONFIG CNAB CADASTRADA! **')
  for (const s of cfg) console.log(' ', s.key, '=', s.value)

  // Contas bancárias
  const accounts = await p.$queryRawUnsafe(`
    SELECT id, name, bank_name, agency, account_number, current_balance, is_active
    FROM accounts
    WHERE company_id = '${o.company_id}' AND is_active = true
  `)
  console.log('')
  console.log('=== CONTAS BANCARIAS ===')
  if (accounts.length === 0) console.log('** NENHUMA CONTA BANCARIA! **')
  for (const a of accounts) {
    console.log(' ', a.name, '|', a.bank_name || '-', '| Ag:', a.agency || '-', '| CC:', a.account_number || '-', '| Saldo: R$', (Number(a.current_balance||0)/100).toFixed(2))
  }

  await p.$disconnect()
}
main().catch(e => { console.error(e.message); process.exit(1) })
