/**
 * Eco audit A (2026-05-30): script de rotação ENCRYPTION_KEY.
 *
 * USO (sequência completa):
 *
 *   1. PRÉ-REQUISITO: deploy de feat/bcda-hardening (commit 9cc96cc6+) já feito.
 *      Esta versão tem encryption.ts/portal-auth.ts com dual-key fallback.
 *
 *   2. Gerar nova key 32 bytes hex:
 *        openssl rand -hex 32
 *
 *   3. No Coolify (painel.pontualtech.work → ERP → Environment):
 *        ENCRYPTION_KEY_OLD = a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6   (placeholder atual)
 *        ENCRYPTION_KEY     = <nova key do passo 2>              (substitui)
 *      Salvar SEM redeploy ainda.
 *
 *   4. Restart ERP via Coolify (Restart, NÃO Rebuild — ~30s).
 *      Após restart: encrypts vão com NEW, decrypts tentam NEW + fallback OLD.
 *      Settings antigas (encrypted com OLD) continuam funcionando via fallback.
 *
 *   5. RODAR ESTE SCRIPT (re-encripta todas settings com NEW):
 *        cd /c/dev/pontual-erp
 *        ENCRYPTION_KEY=<nova> ENCRYPTION_KEY_OLD=<antiga> \
 *          npx tsx scripts/rotate-encryption-key.ts --dry-run
 *
 *        Revisar o que vai fazer. Se OK:
 *        ENCRYPTION_KEY=<nova> ENCRYPTION_KEY_OLD=<antiga> \
 *          npx tsx scripts/rotate-encryption-key.ts --commit
 *
 *   6. VALIDAR INTEGRAÇÕES após migration:
 *        - Bot Marta WhatsApp PT (envia "oi", deve responder)
 *        - Bot Aline WhatsApp IMP (idem)
 *        - Stone: emitir cobrança PIX teste (não confirmar)
 *        - CPF API: criar customer com CPF
 *        - Email Resend IMP: enviar email teste
 *
 *   7. Aguardar 30d (TTL magic-link). Após 30d sem incidente:
 *      - Remover ENCRYPTION_KEY_OLD do Coolify
 *      - Deploy próximo (pode ser commit qualquer) — código simplesmente
 *        ignora OLD se env null.
 */

import { PrismaClient } from '@prisma/client'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const SALT = process.env.ENCRYPTION_SALT || 'pontual-erp-salt'

function deriveKey(envName: 'ENCRYPTION_KEY' | 'ENCRYPTION_KEY_OLD'): Buffer | null {
  const k = process.env[envName]
  if (!k) return null
  return scryptSync(k, SALT, 32)
}

function decryptWith(text: string, key: Buffer): string {
  const [ivHex, tagHex, ct] = text.split(':')
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  let plain = decipher.update(ct, 'hex', 'utf8')
  plain += decipher.final('utf8')
  return plain
}

function encryptWith(plain: string, key: Buffer): string {
  const iv = randomBytes(16)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  let ct = cipher.update(plain, 'utf8', 'hex')
  ct += cipher.final('hex')
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ct}`
}

/**
 * Detecta se valor é provavelmente um setting encrypted no formato
 * `iv:authTag:ciphertext` (3 hex strings separadas por `:`).
 * False positive ok aqui — tentar decrypt num value qualquer falha gracefully.
 */
function looksEncrypted(value: string | null): boolean {
  if (!value) return false
  const parts = value.split(':')
  if (parts.length !== 3) return false
  // iv = 32 hex (16 bytes); authTag = 32 hex (16 bytes); ct = variável
  return /^[0-9a-f]{32}$/.test(parts[0]) && /^[0-9a-f]{32}$/.test(parts[1]) && /^[0-9a-f]+$/.test(parts[2])
}

async function main() {
  const dryRun = !process.argv.includes('--commit')

  const newKey = deriveKey('ENCRYPTION_KEY')
  const oldKey = deriveKey('ENCRYPTION_KEY_OLD')

  if (!newKey) { console.error('ENCRYPTION_KEY não setada — abort'); process.exit(1) }
  if (!oldKey) { console.error('ENCRYPTION_KEY_OLD não setada — abort (precisa pra decrypt valores antigos)'); process.exit(1) }
  if (Buffer.compare(newKey, oldKey) === 0) {
    console.error('ENCRYPTION_KEY === ENCRYPTION_KEY_OLD — sem rotação a fazer, abort')
    process.exit(1)
  }

  console.log(`[rotate] MODE: ${dryRun ? 'DRY-RUN (sem persistir)' : 'COMMIT (vai escrever no DB)'}`)
  console.log(`[rotate] Salt: ${SALT}`)

  const prisma = new PrismaClient()

  try {
    // Lista TODOS settings (não filtramos por nome — looksEncrypted decide)
    const all = await prisma.setting.findMany({
      select: { id: true, company_id: true, key: true, value: true },
    })
    console.log(`[rotate] Total settings no DB: ${all.length}`)

    const encrypted = all.filter(s => looksEncrypted(s.value))
    console.log(`[rotate] Detectados como encrypted (formato iv:tag:ct): ${encrypted.length}`)

    let migrated = 0
    let alreadyNew = 0
    let failed = 0
    let unknown = 0

    for (const s of encrypted) {
      // Tenta decrypt com NEW (já está rotacionado)
      try {
        decryptWith(s.value, newKey)
        alreadyNew++
        continue
      } catch {}

      // Tenta decrypt com OLD (precisa migrar)
      let plain: string
      try {
        plain = decryptWith(s.value, oldKey)
      } catch (e) {
        // Não conseguiu decrypt com nenhuma — pode ser:
        //  (a) formato `iv:tag:ct` casualmente, mas não é encrypted nosso
        //  (b) dado corrompido com 3ª key qualquer
        unknown++
        console.warn(`[rotate] ? SKIP company=${s.company_id.slice(0,8)} key=${s.key} — nem NEW nem OLD decifram`)
        continue
      }

      // Re-encrypt com NEW
      const reEncrypted = encryptWith(plain, newKey)

      console.log(`[rotate] ✓ ${s.company_id.slice(0,8)}... ${s.key} (${plain.length} chars decoded)`)

      if (!dryRun) {
        try {
          await prisma.setting.update({
            where: { id: s.id },
            data: { value: reEncrypted },
          })
          migrated++
        } catch (e) {
          failed++
          console.error(`[rotate] ✗ FAIL update ${s.key}:`, e instanceof Error ? e.message : e)
        }
      } else {
        migrated++  // counts as "would-migrate"
      }
    }

    console.log('')
    console.log('═══ SUMMARY ═══')
    console.log(`Total settings:         ${all.length}`)
    console.log(`Detected encrypted:     ${encrypted.length}`)
    console.log(`${dryRun ? 'WOULD migrate' : 'Migrated'}:       ${migrated}`)
    console.log(`Already on NEW key:     ${alreadyNew} (skipped)`)
    console.log(`Unknown format:         ${unknown} (skipped)`)
    if (!dryRun) console.log(`Update failures:        ${failed}`)
    console.log('')

    if (dryRun) {
      console.log('Dry-run completo. Re-executar com --commit pra persistir.')
    } else {
      console.log(`Rotação concluída. ${migrated} settings agora usam NEW key.`)
      console.log('Próximo passo: aguardar 30d (TTL magic-link), depois remover ENCRYPTION_KEY_OLD.')
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(e => {
  console.error('[rotate] FATAL:', e)
  process.exit(1)
})
