import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

const ALGORITHM = 'aes-256-gcm'

/**
 * Eco audit A (2026-05-30): dual-key fallback pra rotação segura da
 * ENCRYPTION_KEY. Antes desta versão, key era placeholder 'a1b2c3d4...'
 * em produção. Rotação direta quebrava 8 settings encrypted (WhatsApp
 * Cloud PT+IMP, Evolution, Resend, Stone, CPF, app_secret IMP).
 *
 * Fluxo de rotação:
 *   1. Deploy esta versão (suporta NEW + OLD)
 *   2. Setar ENCRYPTION_KEY = nova (32-byte hex aleatório)
 *      Setar ENCRYPTION_KEY_OLD = chave antiga (placeholder a1b2c3d4...)
 *   3. Restart ERP
 *   4. Encrypt SEMPRE usa NEW (writes futuros já vão com new key)
 *   5. Decrypt tenta NEW primeiro; se falhar AuthTag, tenta OLD
 *   6. Rodar migration script: re-encrypt 8 settings c/ NEW key
 *   7. Aguardar 30d (TTL magic-link em circulação)
 *   8. Remover ENCRYPTION_KEY_OLD do Coolify + deploy final
 */

function getKeyFromEnv(envName: 'ENCRYPTION_KEY' | 'ENCRYPTION_KEY_OLD'): Buffer | null {
  const key = process.env[envName]
  if (!key) return null
  const salt = process.env.ENCRYPTION_SALT
  if (!salt && process.env.NODE_ENV === 'production' && envName === 'ENCRYPTION_KEY') {
    console.warn('[Encryption] ENCRYPTION_SALT não configurado em produção — usando salt padrão')
  }
  const effectiveSalt = salt || 'pontual-erp-salt'
  return scryptSync(key, effectiveSalt, 32)
}

function getKey(): Buffer {
  const key = getKeyFromEnv('ENCRYPTION_KEY')
  if (!key) throw new Error('ENCRYPTION_KEY não configurada')
  return key
}

/**
 * Encripta texto sensível (API keys, senhas de certificado).
 * SEMPRE usa ENCRYPTION_KEY atual (não OLD).
 */
export function encrypt(text: string): string {
  const key = getKey()
  const iv = randomBytes(16)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag()

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
}

function decryptWith(encryptedText: string, key: Buffer): string {
  const [ivHex, authTagHex, encrypted] = encryptedText.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

/**
 * Decripta texto. Tenta ENCRYPTION_KEY (nova) primeiro; se falhar
 * com AuthTag inválido E houver ENCRYPTION_KEY_OLD, tenta OLD.
 * Fallback transparente durante janela de rotação.
 */
export function decrypt(encryptedText: string): string {
  const newKey = getKey()
  try {
    return decryptWith(encryptedText, newKey)
  } catch (newErr) {
    // AuthTag fail com NEW → talvez encriptado com OLD (pré-rotação)
    const oldKey = getKeyFromEnv('ENCRYPTION_KEY_OLD')
    if (!oldKey) {
      // Sem OLD configurada — re-throw erro original (sem fallback disponível)
      throw newErr
    }
    try {
      const result = decryptWith(encryptedText, oldKey)
      // Log diagnóstico — útil pra monitorar quantos dados ainda usam OLD
      // (deve cair pra zero conforme migration script roda + tokens expiram)
      if (Math.random() < 0.01) {
        // 1% sampling pra não floodar log
        console.warn('[Encryption] Decrypt usou ENCRYPTION_KEY_OLD (fallback de rotação) — re-encrypt pendente')
      }
      return result
    } catch (oldErr) {
      // Ambas keys falharam — dado corrompido ou outra key totalmente
      console.error('[Encryption] Decrypt falhou com NEW e OLD keys — dado corrompido?')
      throw newErr
    }
  }
}
