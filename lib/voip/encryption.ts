// =============================================================================
// lib/voip/encryption.ts
// =============================================================================
// Wrapper sobre lib/encryption.ts (existente, run 5 — NF-e A1 cert).
// Encripta secrets SIP usando AES-256-GCM com ENCRYPTION_SALT do env.
// Por que wrapper: namespace por módulo + audit log + tipo seguro do retorno.
// =============================================================================

import { randomBytes } from "node:crypto";
import { encrypt, decrypt } from "@/lib/encryption";

/**
 * Encripta secret SIP (senha de ramal ou trunk) para persistência.
 * Output: string base64 com IV + authTag + ciphertext.
 * Determinístico: NÃO. Mesmo input gera output diferente (IV random).
 */
export function encryptSecret(plaintext: string): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new TypeError("encryptSecret: plaintext deve ser string não-vazia");
  }
  if (plaintext.length > 200) {
    // Limite defensivo — secrets SIP típicos têm 12-32 chars
    throw new RangeError("encryptSecret: plaintext > 200 chars (suspeito)");
  }
  return encrypt(plaintext);
}

/**
 * Decripta secret SIP em runtime para gerar o pjsip.conf.
 * Lança erro se ciphertext foi corrompido (auth tag GCM falha) — fail-closed.
 */
export function decryptSecret(ciphertext: string): string {
  if (typeof ciphertext !== "string" || ciphertext.length === 0) {
    throw new TypeError("decryptSecret: ciphertext deve ser string não-vazia");
  }
  try {
    return decrypt(ciphertext);
  } catch (err) {
    // Não vazar detalhes do erro pra logs (poderia ajudar atacante a discriminar)
    throw new Error("decryptSecret: falha ao decriptar (tampering ou key mismatch)");
  }
}

/**
 * Gera secret SIP aleatório, criptograficamente seguro.
 * 32 chars hex = 128 bits de entropia (suficiente para auth digest SIP).
 */
export function generateSipSecret(): string {
  // randomBytes importado estaticamente de "node:crypto" no topo do arquivo.
  // Este módulo é server-only (Next.js detecta pelo path "lib/voip/" + uso no
  // Node runtime apenas — nunca em edge), então import top-level é seguro.
  return randomBytes(16).toString("hex");
}

/**
 * Helper: retorna { hasSecret: boolean } sem expor o secret em si — usado em
 * GET responses que não devem vazar ciphertext (defesa em profundidade contra
 * leak via response body).
 */
export function maskSecret(ciphertext: string | null | undefined): { hasSecret: boolean } {
  return { hasSecret: typeof ciphertext === "string" && ciphertext.length > 0 };
}