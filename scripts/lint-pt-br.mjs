#!/usr/bin/env node
/**
 * Lint pt-BR — detecta palavras pt-BR sem acentuação em strings UI hardcoded.
 *
 * Motivação: Audits 7-10 detectaram 90+ strings UI sem ç/til. TypeCheck e
 * testes não pegam. Este script roda CI pra prevenir regressões futuras.
 *
 * Uso:
 *   node scripts/lint-pt-br.mjs              # full scan
 *   node scripts/lint-pt-br.mjs --fix-stats  # só conta sem listar
 *
 * Exit code 1 se achar bugs (CI fail). 0 se limpo.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCAN_DIR = join(ROOT, 'apps/web/src')
const EXTS = ['.ts', '.tsx', '.js', '.jsx']
const IGNORE_DIRS = ['node_modules', '.next', 'dist', 'build', '__tests__', '.test.', '.spec.']

// Palavras pt-BR comuns que aparecem sem acento em código.
// Cada entrada: [pattern_sem_acento, sugestao_com_acento]
// Pattern é case-sensitive — \b borda de palavra.
const PT_BR_DICTIONARY = [
  ['Servico', 'Serviço'], ['servico', 'serviço'],
  ['Servicos', 'Serviços'], ['servicos', 'serviços'],
  ['Acoes', 'Ações'], ['acoes', 'ações'],
  ['Acao', 'Ação'], ['acao', 'ação'],
  ['Numero', 'Número'], ['numero', 'número'],
  ['Configuracoes', 'Configurações'], ['configuracoes', 'configurações'],
  ['Configuracao', 'Configuração'], ['configuracao', 'configuração'],
  ['Integracoes', 'Integrações'], ['integracoes', 'integrações'],
  ['Integracao', 'Integração'], ['integracao', 'integração'],
  ['Usuarios', 'Usuários'], ['usuarios', 'usuários'],
  ['Usuario', 'Usuário'], ['usuario', 'usuário'],
  ['Permissoes', 'Permissões'], ['permissoes', 'permissões'],
  ['Permissao', 'Permissão'], ['permissao', 'permissão'],
  ['Conclusao', 'Conclusão'], ['conclusao', 'conclusão'],
  ['Concluida', 'Concluída'], ['concluida', 'concluída'],
  ['Concluidas', 'Concluídas'], ['concluidas', 'concluídas'],
  ['Aprovacao', 'Aprovação'], ['aprovacao', 'aprovação'],
  ['Inicio', 'Início'], ['inicio', 'início'],
  ['Funcao', 'Função'], ['funcao', 'função'],
  ['Funcionario', 'Funcionário'], ['funcionario', 'funcionário'],
  ['Lancamento', 'Lançamento'], ['lancamento', 'lançamento'],
  ['Lancamentos', 'Lançamentos'], ['lancamentos', 'lançamentos'],
  ['Conciliacao', 'Conciliação'], ['conciliacao', 'conciliação'],
  ['Liquido', 'Líquido'], ['liquido', 'líquido'],
  ['Liquida', 'Líquida'], ['liquida', 'líquida'],
  ['Exercicio', 'Exercício'], ['exercicio', 'exercício'],
  ['Analise', 'Análise'], ['analise', 'análise'],
  ['Evolucao', 'Evolução'], ['evolucao', 'evolução'],
  ['Categoria', 'Categoria'], // ok com acento — mas vou pular
  ['Descricao', 'Descrição'], ['descricao', 'descrição'],
  ['Saida', 'Saída'], ['saida', 'saída'],
  ['Saidas', 'Saídas'], ['saidas', 'saídas'],
  ['Endereco', 'Endereço'], ['endereco', 'endereço'],
  ['Enderecos', 'Endereços'], ['enderecos', 'endereços'],
  ['Inscricao', 'Inscrição'], ['inscricao', 'inscrição'],
  ['Aliquota', 'Alíquota'], ['aliquota', 'alíquota'],
  ['Discriminacao', 'Discriminação'], ['discriminacao', 'discriminação'],
  ['Modulo', 'Módulo'], ['modulo', 'módulo'],
  ['Codigo', 'Código'], ['codigo', 'código'],
  ['Maximo', 'Máximo'], ['maximo', 'máximo'],
  ['Minimo', 'Mínimo'], ['minimo', 'mínimo'],
  ['Tecnico', 'Técnico'], ['tecnico', 'técnico'],
  ['Tecnicos', 'Técnicos'], ['tecnicos', 'técnicos'],
  ['Tecnica', 'Técnica'], ['tecnica', 'técnica'],
  ['Termica', 'Térmica'], ['termica', 'térmica'],
  ['Logistica', 'Logística'], ['logistica', 'logística'],
  ['Historico', 'Histórico'], ['historico', 'histórico'],
  ['Notificacoes', 'Notificações'], ['notificacoes', 'notificações'],
  ['Notificacao', 'Notificação'], ['notificacao', 'notificação'],
  ['Comunicacao', 'Comunicação'], ['comunicacao', 'comunicação'],
  ['Execucao', 'Execução'], ['execucao', 'execução'],
  ['Aparencia', 'Aparência'], ['aparencia', 'aparência'],
  ['Operacao', 'Operação'], ['operacao', 'operação'],
  ['Operacoes', 'Operações'], ['operacoes', 'operações'],
  ['Movimentacao', 'Movimentação'], ['movimentacao', 'movimentação'],
  ['Manifestacao', 'Manifestação'], ['manifestacao', 'manifestação'],
  ['Situacao', 'Situação'], ['situacao', 'situação'],
  ['Devolucao', 'Devolução'], ['devolucao', 'devolução'],
  ['Negociacao', 'Negociação'], ['negociacao', 'negociação'],
  ['Localizacao', 'Localização'], ['localizacao', 'localização'],
  ['Provisao', 'Provisão'], ['provisao', 'provisão'],
  ['Comissao', 'Comissão'], ['comissao', 'comissão'],
  ['Comissoes', 'Comissões'], ['comissoes', 'comissões'],
  ['Producao', 'Produção'], ['producao', 'produção'],
  ['Recibo', 'Recibo'], // ok
  ['Responsavel', 'Responsável'], ['responsavel', 'responsável'],
  ['Marco', 'Março'], // mês — ATENÇÃO: pode confundir com palavra "marco" (referência)
  ['Liquidacao', 'Liquidação'], ['liquidacao', 'liquidação'],
  ['Restricao', 'Restrição'], ['restricao', 'restrição'],
  ['Selecao', 'Seleção'], ['selecao', 'seleção'],
  ['ultimo', 'último'], ['ultima', 'última'],
  ['ultimos', 'últimos'], ['ultimas', 'últimas'],
  ['proximo', 'próximo'], ['proxima', 'próxima'],
  ['Proximo', 'Próximo'], ['Proxima', 'Próxima'],
  ['medio', 'médio'], ['media', 'média'],
  ['medios', 'médios'], ['medias', 'médias'],
  ['Medio', 'Médio'], ['Media', 'Média'],
  ['SERVICOS', 'SERVIÇOS'], ['SERVICO', 'SERVIÇO'],
  ['ACOES', 'AÇÕES'], ['ACAO', 'AÇÃO'],
  ['CONFIGURACAO', 'CONFIGURAÇÃO'], ['NOTIFICACAO', 'NOTIFICAÇÃO'],
  ['LIQUIDA', 'LÍQUIDA'], ['LIQUIDO', 'LÍQUIDO'],
  ['Cartao', 'Cartão'], ['cartao', 'cartão'],
  ['Cartoes', 'Cartões'], ['cartoes', 'cartões'],
  ['Padrao', 'Padrão'], ['padrao', 'padrão'],
  ['Sao Paulo', 'São Paulo'],
  ['Atencao', 'Atenção'], ['atencao', 'atenção'],
  ['Necessario', 'Necessário'], ['necessario', 'necessário'],
  ['Necessaria', 'Necessária'], ['necessaria', 'necessária'],
  ['Hora', 'Hora'], // ok
  ['Periodo', 'Período'], ['periodo', 'período'],
  ['Mes', 'Mês'], // CUIDADO: também variavel "mes" comum em código
  ['Bancaria', 'Bancária'], ['bancaria', 'bancária'],
  ['Bancarias', 'Bancárias'], ['bancarias', 'bancárias'],
  ['Itau', 'Itaú'],
  ['Pagavel', 'Pagável'], ['pagavel', 'pagável'],
  ['Pagaveis', 'Pagáveis'], ['pagaveis', 'pagáveis'],
  ['Recebivel', 'Recebível'], ['recebivel', 'recebível'],
  ['Recebiveis', 'Recebíveis'], ['recebiveis', 'recebíveis'],
]

// Palavras que aparecem dentro de string literais ou JSX text.
// Match: 'Texto Servico aqui', "Servico", `Servico ${x}`, ou >Servico<
// Ignora: variáveis, identifiers, keys de objetos, imports.
const STRING_PATTERN = /(['"`])([^'"`\n]+?)\1|>([^<>\n]+?)</g

// Ignora se a palavra é parte de um identifier (variável, prop, função)
// ou aparece em comentário com tag específica de "ignore"
const IGNORE_LINE_PATTERNS = [
  /\/\/\s*lint-pt-br:ignore/,
  /\/\*\s*lint-pt-br:ignore/,
]

// Identifiers comuns que contêm a palavra mas NÃO são strings UI
// Eg: `osServico`, `userServico`, etc — quando aparece em scope de variavel
const FALSE_POSITIVE_CONTEXTS = [
  /^(import|export|from|const|let|var|function|interface|type|class|enum)\s/,
  /:\s*['"]/,  // tipo de campo objeto, ex: foo: 'value' já capturado como string
  /\.tsx?:\d+:/,  // path arquivo
]

// Palavras que SÃO falsos positivos (campos schema em inglês, palavras polissêmicas)
const KNOWN_FALSE_POSITIVES = new Set([
  'mes', 'Mes',  // muito comum como variavel JS
  'media', 'Media',  // CSS @media
  'periodo',  // var name comum
  'marco', 'Marco',  // pode ser referencia/landmark, não só mes
  'Categoria',  // já tem acento por padrão
  'Recibo',  // ok sem acento
  'Hora',  // ok sem acento
])

function shouldScanFile(file) {
  return EXTS.some(ext => file.endsWith(ext)) &&
    !file.includes('.test.') &&
    !file.includes('.spec.') &&
    !file.includes('lint-pt-br')  // não escaneia ele mesmo
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

function scanFile(filepath) {
  const text = readFileSync(filepath, 'utf8')
  const lines = text.split('\n')
  const issues = []

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum]

    // Ignora linha com tag explícita
    if (IGNORE_LINE_PATTERNS.some(re => re.test(line))) continue
    // Ignora declarações (variável, import, type, etc.)
    if (FALSE_POSITIVE_CONTEXTS.some(re => re.test(line.trim()))) continue
    // Ignora linhas que são só comentário
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue

    // Procura strings ou JSX text na linha
    let match
    STRING_PATTERN.lastIndex = 0
    while ((match = STRING_PATTERN.exec(line)) !== null) {
      const content = match[2] ?? match[3]
      if (!content) continue
      // Pula se string for muito curta ou parecer URL/path/CSS class
      if (content.length < 3) continue
      if (/^(\/|https?:|[a-z-]+:|#[0-9a-f]{3,8})/i.test(content)) continue
      if (/^[a-z-]+\s+[a-z-]+$/.test(content)) continue  // CSS class chain
      // Identificadores tipo "aparencia.tema", "config.foo.bar" — settings keys
      if (/^[a-z][a-z_0-9]*(\.[a-z][a-z_0-9]*)+$/i.test(content)) continue
      // snake_case puros, ex: "inscricao_estadual" — campo DB/form
      if (/^[a-z][a-z_0-9]*$/.test(content)) continue
      // Apenas ${var} — template puro
      if (/^\$\{[^}]+\}$/.test(content)) continue

      // Procura cada palavra do dicionário
      for (const [bad, good] of PT_BR_DICTIONARY) {
        if (KNOWN_FALSE_POSITIVES.has(bad)) continue
        const re = new RegExp(`\\b${bad}\\b`)
        if (re.test(content)) {
          issues.push({
            line: lineNum + 1,
            col: match.index + 1,
            bad,
            good,
            snippet: content.length > 80 ? content.slice(0, 77) + '...' : content,
          })
          break  // Reporta só 1 issue por string
        }
      }
    }
  }

  return issues
}

function main() {
  const onlyStats = process.argv.includes('--fix-stats')
  const listFiles = process.argv.includes('--list-files')
  console.log('🔎 Lint pt-BR scan: ' + relative(ROOT, SCAN_DIR))
  console.log()

  const files = walkDir(SCAN_DIR)
  console.log(`Scanning ${files.length} files...`)
  console.log()

  let totalIssues = 0
  const byFile = new Map()

  for (const file of files) {
    const issues = scanFile(file)
    if (issues.length > 0) {
      byFile.set(file, issues)
      totalIssues += issues.length
    }
  }

  if (totalIssues === 0) {
    console.log('✅ Nenhum problema de acentuação detectado.')
    process.exit(0)
  }

  if (onlyStats) {
    console.log(`❌ ${totalIssues} issues em ${byFile.size} arquivos`)
    process.exit(1)
  }

  if (listFiles) {
    const sorted = [...byFile.entries()].map(([f, iss]) => ({ f, n: iss.length })).sort((a, b) => b.n - a.n)
    for (const { f, n } of sorted) {
      console.log(`${String(n).padStart(3)}  ${relative(ROOT, f)}`)
    }
    console.log(`\nTotal: ${totalIssues} issues em ${byFile.size} arquivos`)
    process.exit(1)
  }

  // Filter por arquivo se passar --file=path
  const fileArg = process.argv.find(a => a.startsWith('--file='))?.split('=')[1]

  // Print top 30 issues (ou tudo do arquivo específico)
  let printed = 0
  for (const [file, issues] of byFile.entries()) {
    if (fileArg && !file.includes(fileArg)) continue
    if (!fileArg && printed >= 30) break
    const rel = relative(ROOT, file)
    console.log(`📄 ${rel} (${issues.length} issue${issues.length > 1 ? 's' : ''})`)
    const limit = fileArg ? issues.length : 5
    for (const iss of issues.slice(0, limit)) {
      console.log(`   :${iss.line}  "${iss.bad}" → "${iss.good}"`)
      console.log(`        snippet: "${iss.snippet}"`)
      printed++
    }
    if (!fileArg && issues.length > 5) console.log(`   ... +${issues.length - 5} more`)
    console.log()
  }

  console.log(`❌ ${totalIssues} acentos faltando em ${byFile.size} arquivos`)
  console.log()
  console.log('Para silenciar uma linha (intencional): adicione // lint-pt-br:ignore')
  process.exit(1)
}

main()
