#!/usr/bin/env node
/**
 * Lint estrutural — detecta padrões anti-pattern críticos no código:
 *
 * 1. MULTI-TENANT: Prisma queries sem company_id em where (LGPD/IDOR risk)
 * 2. SECRETS: tokens/keys hardcoded
 * 3. CONSOLE: console.log em src/ produção (debug leftover)
 * 4. ANY: `: any` em fronteiras de API/tipos exportados
 *
 * Histórico que motivou:
 * - Audit 7: customer_id leak (snake_case mismatch)
 * - Audit 9: total_amount field bug (any tipos)
 * - Multi-tenant Sprint: 5 fixes IDOR críticos
 * - Auth Sprint: fallback-dev-secret hardcoded
 *
 * Uso:
 *   node scripts/lint-structural.mjs              # full
 *   node scripts/lint-structural.mjs --check=multi-tenant
 *   node scripts/lint-structural.mjs --check=secrets
 *   node scripts/lint-structural.mjs --check=console
 *   node scripts/lint-structural.mjs --check=any
 *   node scripts/lint-structural.mjs --severity=high  # só HIGH/CRITICAL
 *
 * Para silenciar: // lint-struct:ignore
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCAN_DIR = join(ROOT, 'apps/web/src')
const EXTS = ['.ts', '.tsx']
const IGNORE_DIRS = ['node_modules', '.next', 'dist', 'build', '__tests__', '.test.', '.spec.']

const checkArg = process.argv.find(a => a.startsWith('--check='))?.split('=')[1] ?? 'all'
const severityArg = process.argv.find(a => a.startsWith('--severity='))?.split('=')[1] ?? 'all'

const SEVERITY_LEVELS = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 }
const minSeverity = SEVERITY_LEVELS[severityArg.toUpperCase()] ?? 1

// Padrões que indicam fronteira de API (route handlers, server actions, etc)
const API_BOUNDARY_FILES = /\/(api|app)\/.+\/route\.tsx?$|server-actions?\.tsx?$/

function shouldScanFile(file) {
  if (!EXTS.some(ext => file.endsWith(ext))) return false
  if (file.includes('.test.') || file.includes('.spec.')) return false
  if (file.includes('lint-')) return false
  return true
}

function walkDir(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    if (IGNORE_DIRS.some(d => entry.includes(d))) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walkDir(full))
    else if (shouldScanFile(full)) out.push(full)
  }
  return out
}

// ─── CHECK 1: MULTI-TENANT GUARD ───────────────────────────────────────────
// Detecta queries Prisma onde:
// - findFirst({ where: { id }}) sem company_id
// - findUnique({ where: { id }}) sem company_id (não tem como filtrar — usar findFirst)
// - update / delete / updateMany sem company_id em where
//
// FALSOS POSITIVOS conhecidos (whitelist):
// - Paths internos cross-tenant by-design: /api/admin/, /api/super-admin/, /api/cron/, /api/internal/
// - Webhooks externos (Asaas, Inter, Chatwoot) que vêm sem auth tenant
// - Chaves UNIQUE GLOBAL: idempotency_key, event_id, chatwoot_conv_id,
//   magic_link_token, jti, password_reset_token, nosso_numero, asaas_payment_id
// - where: { id: <var>.id } onde <var> já foi tenant-scoped no escopo
//   (heurística: arquivo contém withTenantTx ou findFirst com company_id)
const CROSS_TENANT_PATH_RE = /\/(admin|super-admin|cron|internal|webhooks?)\//
const WEBHOOK_FILE_RE = /\/webhook\//
const UNIQUE_GLOBAL_KEYS = [
  'idempotency_key', 'event_id', 'chatwoot_conv_id', 'magic_link_token',
  'jti', 'password_reset_token', 'nosso_numero', 'asaas_payment_id',
  'asaas_id', 'token', 'invite_token', 'visit_confirm_token',
]

// Modelos que SEMPRE são tenant-resolution (operam antes/sem tenant context):
// company (resolve via slug/id), userProfile (auth login), loginOtp,
// passwordReset, magicLink, customerAccess (portal cliente), botConversation
// (operação por chatwoot_conv_id que é unique global - já mapeado defer)
const TENANT_RESOLUTION_MODELS = new Set([
  'company', 'userProfile', 'loginOtp', 'passwordReset', 'magicLink',
  'customerAccess', 'session', 'apiKey',
])

function checkMultiTenant(filepath, text, lines) {
  const issues = []
  // É arquivo de API/route ou lib que usa prisma?
  if (!/prisma\.(customer|service_order|invoice|receivable|payable|payment|os_item|asset|notification|ticket|chat_message|route|stop|visit|event)/.test(text)) {
    return issues
  }
  // Whitelist: paths cross-tenant by-design
  const normPath = filepath.replace(/\\/g, '/')
  if (CROSS_TENANT_PATH_RE.test(normPath)) return issues
  if (WEBHOOK_FILE_RE.test(normPath)) return issues
  // Auth paths são tenant-resolution
  if (/\/api\/(auth|portal\/auth|portal\/cadastro|portal\/check)/.test(normPath)) return issues
  // Heurística: se o arquivo já tem withTenantTx ou findFirst({company_id}),
  // assumir que sub-queries no mesmo escopo são tenant-safe (followup queries)
  const hasTenantContext = /withTenantTx|company_id:\s*user\.companyId|company_id:\s*companyId/.test(text)

  // Padrão suspeito: prisma.X.findFirst({ where: { id... } }) onde where NÃO contém company_id
  // Multiline regex que captura o bloco where { ... }
  const queryPattern = /prisma\.(\w+)\.(findFirst|findUnique|update|delete|updateMany|deleteMany|count|aggregate)\s*\(\s*\{[^}]*?where:\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g

  let match
  while ((match = queryPattern.exec(text)) !== null) {
    const model = match[1]
    const op = match[2]
    const whereBlock = match[3]
    // skip se where contém company_id ou companyId
    if (/company_?[Ii]d/.test(whereBlock)) continue
    // skip se where contém ...spread (assume spread var tem company_id —
    // padrão `const base = { company_id }; { where: { ...base, ... }}`)
    if (/\.\.\.\w+/.test(whereBlock)) continue
    // skip modelos de tenant-resolution (company, userProfile, loginOtp, etc)
    if (TENANT_RESOLUTION_MODELS.has(model)) continue
    // skip se é findUnique por chave composta (já é tenant-safe)
    if (op === 'findUnique' && /\w+_company_id/.test(whereBlock)) continue
    // skip se where usa chave UNIQUE GLOBAL by-design (idempotency, tokens, etc)
    if (UNIQUE_GLOBAL_KEYS.some(k => new RegExp(`\\b${k}\\b`).test(whereBlock))) continue
    // skip se where: { id: <var>.id } onde var é local + arquivo tem tenant context
    // (assumir que <var> foi obtido via query tenant-safe anterior)
    if (hasTenantContext && /\bid:\s*\w+\.id\b/.test(whereBlock) && !/[a-z_]+_id:\s*\w+\.id/.test(whereBlock)) continue
    // skip update/delete onde where: {id: <var>.id} mesmo sem hasTenantContext —
    // padrão muito comum: var foi buscada tenant-safe linha acima
    if ((op === 'update' || op === 'delete') && /^\s*id:\s*\w+\.id\s*$/.test(whereBlock.trim())) continue
    const lineIdx = text.slice(0, match.index).split('\n').length
    const line = lines[lineIdx - 1] || ''
    if (/lint-struct:ignore/.test(line) || /lint-struct:ignore/.test(lines[lineIdx - 2] || '')) continue
    issues.push({
      check: 'multi-tenant',
      severity: 'CRITICAL',
      line: lineIdx,
      message: `prisma.${model}.${op}() sem company_id em where — risk IDOR/LGPD`,
      snippet: `where: {${whereBlock.trim().slice(0, 100)}${whereBlock.length > 100 ? '...' : ''}}`,
    })
  }
  return issues
}

// ─── CHECK 2: SECRETS HARDCODED ────────────────────────────────────────────
const SECRET_PATTERNS = [
  { re: /['"](sk-[a-zA-Z0-9]{20,})['"]/, label: 'OpenAI key', severity: 'CRITICAL' },
  { re: /['"](xoxb-[a-zA-Z0-9-]{20,})['"]/, label: 'Slack bot token', severity: 'CRITICAL' },
  { re: /['"](AKIA[0-9A-Z]{16})['"]/, label: 'AWS access key', severity: 'CRITICAL' },
  { re: /['"](ghp_[a-zA-Z0-9]{36})['"]/, label: 'GitHub PAT', severity: 'CRITICAL' },
  { re: /['"](aass_[A-Za-z0-9]{20,})['"]/, label: 'Asaas API key', severity: 'CRITICAL' },
  { re: /Bearer\s+[a-zA-Z0-9._-]{30,}/, label: 'Bearer token literal', severity: 'HIGH' },
  { re: /password\s*[:=]\s*['"][^'"$]{6,}['"]/i, label: 'Hardcoded password', severity: 'HIGH' },
  { re: /['"](postgres|postgresql):\/\/[^:]+:[^@]+@/, label: 'DB URL com senha', severity: 'CRITICAL' },
  { re: /['"]eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}['"]/, label: 'JWT token', severity: 'HIGH' },
]

function checkSecrets(filepath, text, lines) {
  const issues = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/lint-struct:ignore/.test(line)) continue
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue  // comentários
    for (const { re, label, severity } of SECRET_PATTERNS) {
      if (re.test(line)) {
        issues.push({
          check: 'secrets',
          severity,
          line: i + 1,
          message: `Possível ${label} hardcoded`,
          snippet: line.trim().slice(0, 100),
        })
        break
      }
    }
  }
  return issues
}

// ─── CHECK 3: CONSOLE.LOG EM PRODUÇÃO ─────────────────────────────────────
// console.log em arquivos src/ (excluindo lint, scripts, tests)
function checkConsole(filepath, text, lines) {
  const issues = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/lint-struct:ignore/.test(line)) continue
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue
    // console.log/warn/info — error é OK (genuine logging)
    const m = line.match(/\bconsole\.(log|info|debug|trace)\s*\(/)
    if (m) {
      issues.push({
        check: 'console',
        severity: 'LOW',
        line: i + 1,
        message: `console.${m[1]}() em código de produção`,
        snippet: line.trim().slice(0, 100),
      })
    }
  }
  return issues
}

// ─── CHECK 4: ANY EM FRONTEIRAS DE API ─────────────────────────────────────
function checkAny(filepath, text, lines) {
  const issues = []
  // Só rodar em arquivos de API/route boundary
  const isApiBoundary = API_BOUNDARY_FILES.test(filepath.replace(/\\/g, '/'))
  if (!isApiBoundary) return issues

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/lint-struct:ignore/.test(line)) continue
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue
    // : any em params, return, var. Pula `as any` (cast intencional)
    const anyMatch = line.match(/(?<!as\s)\b:\s*any\b(?!\[)/)
    if (anyMatch) {
      issues.push({
        check: 'any',
        severity: 'MEDIUM',
        line: i + 1,
        message: 'Tipo any em fronteira de API — preferir tipo Prisma direto',
        snippet: line.trim().slice(0, 100),
      })
    }
  }
  return issues
}

// ─── MAIN ──────────────────────────────────────────────────────────────────
function scanFile(filepath) {
  const text = readFileSync(filepath, 'utf8')
  const lines = text.split('\n')
  const allIssues = []
  if (checkArg === 'all' || checkArg === 'multi-tenant') {
    allIssues.push(...checkMultiTenant(filepath, text, lines))
  }
  if (checkArg === 'all' || checkArg === 'secrets') {
    allIssues.push(...checkSecrets(filepath, text, lines))
  }
  if (checkArg === 'all' || checkArg === 'console') {
    allIssues.push(...checkConsole(filepath, text, lines))
  }
  if (checkArg === 'all' || checkArg === 'any') {
    allIssues.push(...checkAny(filepath, text, lines))
  }
  return allIssues.filter(i => SEVERITY_LEVELS[i.severity] >= minSeverity)
}

function main() {
  console.log(`🔎 Lint estrutural — check=${checkArg}, severity≥${severityArg}`)
  console.log()

  const files = walkDir(SCAN_DIR)
  console.log(`Scanning ${files.length} files...`)
  console.log()

  const byCheck = { 'multi-tenant': [], secrets: [], console: [], any: [] }
  let totalIssues = 0

  for (const file of files) {
    const issues = scanFile(file)
    for (const iss of issues) {
      iss.file = file
      byCheck[iss.check].push(iss)
      totalIssues++
    }
  }

  if (totalIssues === 0) {
    console.log('✅ Nenhum problema estrutural detectado.')
    process.exit(0)
  }

  // Ordem de severidade
  const ordered = ['multi-tenant', 'secrets', 'any', 'console']

  for (const check of ordered) {
    const issues = byCheck[check]
    if (issues.length === 0) continue

    const SEV_EMOJI = { CRITICAL: '🔥', HIGH: '⚠️ ', MEDIUM: '🟡', LOW: '🔵' }
    console.log()
    console.log(`━━━ ${check.toUpperCase()} (${issues.length} issues) ━━━`)
    console.log()

    // Agrupa por arquivo
    const byFile = new Map()
    for (const iss of issues) {
      if (!byFile.has(iss.file)) byFile.set(iss.file, [])
      byFile.get(iss.file).push(iss)
    }

    let printed = 0
    const limit = 25
    for (const [file, fileIssues] of byFile.entries()) {
      if (printed >= limit) break
      console.log(`📄 ${relative(ROOT, file)}`)
      for (const iss of fileIssues.slice(0, 3)) {
        console.log(`   ${SEV_EMOJI[iss.severity]} :${iss.line}  ${iss.message}`)
        console.log(`        snippet: ${iss.snippet}`)
        printed++
      }
      if (fileIssues.length > 3) console.log(`   ... +${fileIssues.length - 3} more`)
    }
    if (issues.length > limit) console.log(`\n   ... +${issues.length - limit} more (use --check=${check} pra full list)`)
  }

  console.log()
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('SUMÁRIO:')
  for (const check of ordered) {
    if (byCheck[check].length === 0) continue
    const sevs = {}
    for (const iss of byCheck[check]) sevs[iss.severity] = (sevs[iss.severity] || 0) + 1
    const sevStr = Object.entries(sevs).map(([s, n]) => `${s}=${n}`).join(' ')
    console.log(`  ${check}: ${byCheck[check].length} (${sevStr})`)
  }
  console.log(`\n❌ TOTAL: ${totalIssues} issues`)
  console.log()
  console.log('Para silenciar uma linha (intencional): // lint-struct:ignore')
  process.exit(1)
}

main()
