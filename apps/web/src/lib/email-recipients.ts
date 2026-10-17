// O campo de e-mail do cadastro às vezes tem mais de um endereço ("a@x.com;b@y.com").
// O Resend recusa essa string inteira (422 "Invalid `to` field") e o cliente não recebe nada.
// Aqui a lista é separada por ";" ou ",", limpa e sem repetidos (sem diferenciar maiúsculas).
export function parseRecipients(to: string): string[] {
  const vistos = new Set<string>()
  const lista: string[] = []
  for (const parte of String(to || '').split(/[;,]/)) {
    const e = parte.trim()
    if (!e) continue
    const chave = e.toLowerCase()
    if (vistos.has(chave)) continue
    vistos.add(chave)
    lista.push(e)
  }
  return lista
}
