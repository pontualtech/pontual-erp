import { redirect } from 'next/navigation'

// /voip nao tem tela propria — o segmento e so um agrupador (Chamadas, Ramais).
// Sem este index, qualquer link pro pai (breadcrumb, command-palette, prefetch)
// caia em 404. Redireciona pra a tela default de chamadas. (Eco audit 13/06)
export default function VoipIndexPage() {
  redirect('/voip/calls')
}
