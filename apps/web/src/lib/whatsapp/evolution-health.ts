/**
 * Classifica a resposta da sonda ativa de liveness do Evolution.
 *
 * A sonda e `POST /chat/whatsappNumbers/{inst}` — forca um round-trip REAL ao
 * WhatsApp (verifica se um numero existe). Socket vivo -> responde
 * `[{"exists":true|false,...}]`. Zumbi (state=open mas socket morto) nao
 * completa o round-trip -> timeout/erro/vazio, sem o campo `"exists"`.
 *
 * Por que nao usar `state`/`updatedAt`: `state` fica "open" no zumbi (mente) e
 * `updatedAt` so bumpa com mensagem (instancia quieta parece morta = falso
 * positivo). O round-trip e o unico sinal confiavel.
 */
export function isAliveProbe(ok: boolean, body: string): boolean {
  return ok && /"exists"\s*:/.test(body)
}
