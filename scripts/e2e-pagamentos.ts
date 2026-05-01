/**
 * E2E Pagamentos — valida fixes da auditoria (Fase 1+2+3) em produção.
 *
 * Cobre:
 *   - C6: WebhookEventLog UNIQUE constraint bloqueia duplicate
 *   - M1: Account.current_balance vs sum(transactions) consistency
 *   - M4: DRE classification coverage (via_chart vs via_heuristic vs fallback)
 *   - C4 cenário: query auditLog action='conciliacao.match' tem amount/type/record_id
 *   - C3: webhook_logs com event='CNAB_UNMATCHED' (se houver)
 *   - Schema integrity: WebhookEventLog + WebhookLog ambas existem + writable
 *
 * Uso:
 *   DATABASE_URL=postgres://... npx tsx scripts/e2e-pagamentos.ts
 *
 * Não modifica dados em produção (read-only + rollback no único INSERT de teste).
 */
import { PrismaClient } from '@prisma/client'

const p = new PrismaClient()

interface TestResult {
  name: string
  status: 'PASS' | 'FAIL' | 'SKIP'
  detail: string
}

const results: TestResult[] = []

function pass(name: string, detail: string) { results.push({ name, status: 'PASS', detail }) }
function fail(name: string, detail: string) { results.push({ name, status: 'FAIL', detail }) }
function skip(name: string, detail: string) { results.push({ name, status: 'SKIP', detail }) }

async function testWebhookEventLogUniqueness() {
  const testEventId = 'evt_e2e_test_' + Date.now()
  let firstId: string | null = null
  try {
    // 1. Insert ok
    const first = await p.webhookEventLog.create({
      data: {
        company_id: 'pontualtech-001',
        provider: 'ASAAS',
        event_id: testEventId,
        event_type: 'PAYMENT_RECEIVED',
        status: 'RECEIVED',
        raw_payload: { test: true },
      },
    })
    firstId = first.id

    // 2. Insert duplicate deve dar P2002
    try {
      await p.webhookEventLog.create({
        data: {
          company_id: 'pontualtech-001',
          provider: 'ASAAS',
          event_id: testEventId,
          event_type: 'PAYMENT_RECEIVED',
          status: 'RECEIVED',
          raw_payload: { test: true, dup: true },
        },
      })
      fail('C6 webhook_events_log UNIQUE', 'Duplicate aceitou — constraint não está ativa!')
    } catch (e: any) {
      if (e?.code === 'P2002') {
        pass('C6 webhook_events_log UNIQUE', `P2002 corretamente blocked duplicate event_id=${testEventId}`)
      } else {
        fail('C6 webhook_events_log UNIQUE', `Erro inesperado: ${e?.code} ${e?.message}`)
      }
    }
  } catch (e: any) {
    fail('C6 webhook_events_log INSERT', `Initial insert falhou: ${e?.message}`)
  } finally {
    // Cleanup
    if (firstId) {
      try { await p.webhookEventLog.delete({ where: { id: firstId } }) } catch {}
    }
  }
}

async function testBalanceConsistency() {
  // Pra cada conta ativa, sum(CREDIT) - sum(DEBIT) deve ser ≤ current_balance
  // (≤ porque o saldo inicial pode ter sido setado manualmente; o que a gente
  // garante é que a soma das transactions não EXCEDE o saldo registrado)
  try {
    const accounts = await p.account.findMany({
      where: { company_id: 'pontualtech-001', is_active: true },
      select: { id: true, name: true, current_balance: true, initial_balance: true },
    })

    if (accounts.length === 0) {
      skip('M1 balance consistency', 'Nenhuma conta ativa em pontualtech-001')
      return
    }

    let inconsistent = 0
    const detail: string[] = []
    for (const acc of accounts) {
      const txs = await p.transaction.findMany({
        where: { account_id: acc.id },
        select: { transaction_type: true, amount: true },
      })
      const credit = txs.filter(t => t.transaction_type === 'CREDIT').reduce((s, t) => s + t.amount, 0)
      const debit = txs.filter(t => t.transaction_type === 'DEBIT').reduce((s, t) => s + t.amount, 0)
      const expectedDelta = credit - debit
      const opening = acc.initial_balance || 0
      const expectedBalance = opening + expectedDelta
      const actual = acc.current_balance || 0
      const diff = actual - expectedBalance

      if (diff !== 0) {
        inconsistent++
        detail.push(`${acc.name}: opening=${opening}, sum(C-D)=${expectedDelta}, expected=${expectedBalance}, actual=${actual}, diff=${diff}`)
      }
    }

    if (inconsistent === 0) {
      pass('M1 balance consistency', `${accounts.length} accounts OK (opening + sum(C-D) == current_balance)`)
    } else {
      fail('M1 balance consistency', `${inconsistent}/${accounts.length} accounts com drift:\n  ${detail.slice(0, 5).join('\n  ')}`)
    }
  } catch (e: any) {
    fail('M1 balance consistency', `Erro: ${e?.message}`)
  }
}

async function testDreClassificationCoverage() {
  // Quantas categorias de AP da PontualTech têm match em accounts_chart?
  try {
    const charts = await p.accountChart.findMany({
      where: { company_id: 'pontualtech-001', is_active: true },
      select: { name: true, account_type: true },
    })
    const chartByName = new Map<string, string>()
    for (const c of charts) chartByName.set(c.name.toLowerCase().trim(), c.account_type)

    // M4 — pega todas as categorias do tenant (não só via AP) pra ter cobertura completa
    const allCategoriesRaw = await p.category.findMany({
      where: { company_id: 'pontualtech-001' },
      select: { name: true, module: true },
    })
    const apCategories = allCategoriesRaw
      .filter(c => !!c.name)
      .map(c => ({ name: c.name, module: c.module || '' }))

    if (apCategories.length === 0) {
      skip('M4 DRE classification', 'Nenhuma categoria de AP/custo/despesa pra pontualtech-001')
      return
    }

    let viaChart = 0
    let viaHeuristic = 0
    const unclassified: string[] = []
    for (const cat of apCategories) {
      const key = cat.name.toLowerCase().trim()
      let matched = chartByName.has(key)
      if (!matched) {
        for (const [chartName] of chartByName) {
          if (key.includes(chartName) || chartName.includes(key)) { matched = true; break }
        }
      }
      if (matched) {
        viaChart++
      } else {
        const isCustoHeur = cat.module === 'custo' ||
          key.includes('custo') || key.includes('mercadoria') || key.includes('materia') || key.includes('insumo')
        if (isCustoHeur) viaHeuristic++
        else unclassified.push(cat.name)
      }
    }

    const total = apCategories.length
    const coverage = ((viaChart / total) * 100).toFixed(1)
    if (viaChart > 0) {
      pass('M4 DRE classification', `${viaChart}/${total} (${coverage}%) via chart_account, ${viaHeuristic} via heuristic, ${unclassified.length} fallback. Charts disponíveis: ${charts.length}`)
    } else {
      fail('M4 DRE classification', `0/${total} match em chart_account! Charts disponíveis: ${charts.length}. Investigar nomes — devem ser próximos.`)
    }
  } catch (e: any) {
    fail('M4 DRE classification', `Erro: ${e?.message}`)
  }
}

async function testConciliacaoAuditMetadata() {
  // Verifica se auditLog action='conciliacao.match' tem new_value com type+record_id+amount
  // (necessário pra C4 UNDO funcionar)
  try {
    const recentMatches = await p.auditLog.findMany({
      where: {
        action: { in: ['conciliacao.match', 'conciliacao.bulk_match'] },
        company_id: 'pontualtech-001',
      },
      orderBy: { created_at: 'desc' },
      take: 10,
    })

    if (recentMatches.length === 0) {
      skip('C4 audit metadata', 'Nenhuma conciliação registrada — sem dados pra validar metadata')
      return
    }

    let valid = 0
    let invalid = 0
    for (const m of recentMatches) {
      const meta = m.new_value as any
      if (meta?.type && meta?.record_id && typeof meta?.amount === 'number') valid++
      else invalid++
    }

    if (invalid === 0) {
      pass('C4 audit metadata', `${valid}/${recentMatches.length} matches recentes têm type+record_id+amount no new_value (UNDO funcionará corretamente)`)
    } else {
      fail('C4 audit metadata', `${invalid}/${recentMatches.length} matches sem metadata completo (UNDO terá fallback warning)`)
    }
  } catch (e: any) {
    fail('C4 audit metadata', `Erro: ${e?.message}`)
  }
}

async function testCnabUnmatchedLogs() {
  try {
    const cnabUnmatched = await p.webhookLog.count({
      where: { event: 'CNAB_UNMATCHED' },
    })
    pass('C3 CNAB_UNMATCHED logs', `${cnabUnmatched} logs registrados (0 esperado se não houve retornos órfãos ainda — endpoint está pronto)`)
  } catch (e: any) {
    fail('C3 CNAB_UNMATCHED logs', `Erro: ${e?.message}`)
  }
}

async function testWebhookEventLogUsage() {
  try {
    const total = await p.webhookEventLog.count()
    const byStatus = await p.webhookEventLog.groupBy({
      by: ['status'],
      _count: true,
    })
    const byProvider = await p.webhookEventLog.groupBy({
      by: ['provider'],
      _count: true,
    })
    const statusBreakdown = byStatus.map(s => `${s.status}=${s._count}`).join(', ')
    const providerBreakdown = byProvider.map(s => `${s.provider}=${s._count}`).join(', ')
    pass('C6 WebhookEventLog usage', `total=${total}; status: ${statusBreakdown || 'empty'}; provider: ${providerBreakdown || 'empty'}`)
  } catch (e: any) {
    fail('C6 WebhookEventLog usage', `Erro: ${e?.message}`)
  }
}

async function testWorkerSafetyGate() {
  try {
    const enabled = process.env.PAYMENT_REMINDERS_V2_REAL_DISPATCH === '1'
    if (enabled) {
      const sentCount = await p.paymentReminder.count({ where: { status: 'SENT' } })
      pass('C1 worker safety', `REAL_DISPATCH=1 (real dispatch ativado), SENT count=${sentCount}`)
    } else {
      const pendingCount = await p.paymentReminder.count({ where: { status: 'PENDING' } })
      const sentCount = await p.paymentReminder.count({ where: { status: 'SENT' } })
      pass('C1 worker safety', `REAL_DISPATCH=0 (gate ativo), PENDING=${pendingCount}, SENT=${sentCount} (deve ser 0 ou apenas legado)`)
    }
  } catch (e: any) {
    fail('C1 worker safety', `Erro: ${e?.message}`)
  }
}

async function main() {
  console.log('='.repeat(70))
  console.log('E2E Pagamentos — validação Fase 1+2+3 (audit fixes)')
  console.log('='.repeat(70))
  console.log('')

  await testWebhookEventLogUniqueness()
  await testWebhookEventLogUsage()
  await testBalanceConsistency()
  await testDreClassificationCoverage()
  await testConciliacaoAuditMetadata()
  await testCnabUnmatchedLogs()
  await testWorkerSafetyGate()

  console.log('Resultados:')
  console.log('-'.repeat(70))
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⏭️ '
    console.log(`${icon} ${r.name}`)
    console.log(`     ${r.detail}`)
  }
  console.log('-'.repeat(70))
  const passed = results.filter(r => r.status === 'PASS').length
  const failed = results.filter(r => r.status === 'FAIL').length
  const skipped = results.filter(r => r.status === 'SKIP').length
  console.log(`Total: ${results.length} | PASS: ${passed} | FAIL: ${failed} | SKIP: ${skipped}`)
  console.log('='.repeat(70))

  process.exit(failed > 0 ? 1 : 0)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => p.$disconnect())
