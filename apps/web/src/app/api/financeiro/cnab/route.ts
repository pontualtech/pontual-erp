import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { gerarRemessaCNAB400, parsearRetornoCNAB400, type BoletoRemessa400, type CedenteConfig400 } from '@/lib/boleto/cnab/cnab400-inter'

/**
 * GET /api/financeiro/cnab — Gerar arquivo de remessa CNAB 400
 *
 * Query params:
 * - ids: comma-separated list of AccountReceivable IDs
 * - all_pending: "true" para incluir todas pendentes sem boleto
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission('fiscal', 'create')
    if (auth instanceof NextResponse) return auth
    const user = auth

    const { searchParams } = new URL(req.url)
    const ids = searchParams.get('ids')?.split(',').filter(Boolean) || []
    const allPending = searchParams.get('all_pending') === 'true'

    // Buscar config bancária
    const settings = await prisma.setting.findMany({
      where: {
        company_id: user.companyId,
        key: { in: ['cnab.cnpj', 'cnab.razao_social', 'cnab.agencia', 'cnab.conta', 'cnab.convenio', 'cnab.carteira', 'cnab.sequencial'] },
      },
    })
    const cfg: Record<string, string> = {}
    for (const s of settings) cfg[s.key] = s.value

    if (!cfg['cnab.cnpj'] || !cfg['cnab.conta'] || !cfg['cnab.agencia']) {
      return NextResponse.json({ error: 'Configure os dados bancários em Configurações > Boletos CNAB' }, { status: 400 })
    }

    // Buscar contas a receber
    let whereClause: any = { company_id: user.companyId, status: 'PENDENTE' }
    if (ids.length > 0) {
      whereClause.id = { in: ids }
    } else if (allPending) {
      whereClause.boleto_url = null // Só as que ainda não têm boleto
    } else {
      return NextResponse.json({ error: 'Informe ids ou all_pending=true' }, { status: 400 })
    }

    const receivables = await prisma.accountReceivable.findMany({
      where: whereClause,
      include: {
        customers: { select: { legal_name: true, document_number: true, email: true, address_street: true, address_number: true, address_neighborhood: true, address_city: true, address_state: true, address_zip: true } },
      },
      orderBy: { due_date: 'asc' },
    })

    if (receivables.length === 0) {
      return NextResponse.json({ error: 'Nenhuma conta a receber encontrada para gerar remessa' }, { status: 404 })
    }

    // Montar boletos CNAB 400
    const boletos: BoletoRemessa400[] = []
    for (const r of receivables) {
      if (!r.customers?.document_number) continue

      const vencDiaSeguinte = new Date(r.due_date)
      vencDiaSeguinte.setDate(vencDiaSeguinte.getDate() + 1)

      boletos.push({
        seuNumero: r.id.substring(0, 10),
        dataVencimento: r.due_date,
        valorNominal: r.total_amount,
        diasAposVencimento: 30,
        sacadoNome: r.customers.legal_name,
        sacadoDocumento: r.customers.document_number,
        sacadoEndereco: `${r.customers.address_street || ''} ${r.customers.address_number || ''}`.trim() || 'NAO INFORMADO',
        sacadoUF: r.customers.address_state || 'SP',
        sacadoCEP: r.customers.address_zip || '00000000',
        sacadoEmail: r.customers.email || undefined,
        multa: { tipo: '2', percentual: 2.00, data: vencDiaSeguinte },
        juros: { tipo: '2', taxaMensal: 1.00, data: vencDiaSeguinte },
        mensagem: r.description || '',
        controleParticipante: r.id.substring(0, 25),
      })
    }

    if (boletos.length === 0) {
      return NextResponse.json({ error: 'Nenhuma conta com cliente válido (CPF/CNPJ)' }, { status: 400 })
    }

    // Gerar sequencial
    const seqAtual = parseInt(cfg['cnab.sequencial'] || '0') + 1
    await prisma.setting.upsert({
      where: { company_id_key: { company_id: user.companyId, key: 'cnab.sequencial' } },
      create: { company_id: user.companyId, key: 'cnab.sequencial', value: String(seqAtual), type: 'number' },
      update: { value: String(seqAtual) },
    })

    const cedente: CedenteConfig400 = {
      razaoSocial: cfg['cnab.razao_social'] || 'EMPRESA',
      agencia: cfg['cnab.agencia'] || '0001',
      conta: cfg['cnab.conta']?.replace(/\D/g, '').substring(0, 9) || '',
      contaDV: cfg['cnab.conta']?.slice(-1) || '0',
      carteira: cfg['cnab.carteira'] || '112',
    }

    const { conteudo, nomeArquivo } = gerarRemessaCNAB400(cedente, boletos, seqAtual)

    // Marcar as contas como tendo boleto em processamento
    for (const r of receivables) {
      if (!r.customers?.document_number) continue
      await prisma.accountReceivable.update({
        where: { id: r.id },
        data: {
          boleto_url: `cnab://remessa-${seqAtual}`,
          pix_code: JSON.stringify({ boletoStatus: 'REGISTRANDO', provider: 'cnab_inter', remessa: seqAtual, generatedAt: new Date().toISOString() }),
        },
      })
    }

    // IDs dos boletos gerados (para frontend usar em print/email)
    const boletoIds = receivables
      .filter(r => r.customers?.document_number)
      .map(r => r.id)

    // Retornar como arquivo para download (CNAB 400 Inter)
    return new NextResponse(conteudo, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${nomeArquivo}"`,
        'X-Boleto-Ids': boletoIds.join(','),
        'Access-Control-Expose-Headers': 'X-Boleto-Ids',
      },
    })
  } catch (e: any) {
    console.error('Erro gerar CNAB:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

/**
 * POST /api/financeiro/cnab — Processar arquivo de retorno CNAB 400
 *
 * Body: { content: string } (conteúdo do arquivo .ret)
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission('fiscal', 'create')
    if (auth instanceof NextResponse) return auth
    const user = auth

    const body = await req.json()
    const content = body.content as string

    if (!content || content.length < 240) {
      return NextResponse.json({ error: 'Arquivo de retorno vazio ou inválido' }, { status: 400 })
    }

    const retornos = parsearRetornoCNAB400(content)

    let pagos = 0, rejeitados = 0, outros = 0

    for (const ret of retornos) {
      // Buscar conta a receber pelo seuNumero (ID parcial) ou nossoNumero
      const receivable = await prisma.accountReceivable.findFirst({
        where: {
          company_id: user.companyId,
          OR: [
            { id: { startsWith: ret.seuNumero } },
            { pix_code: { contains: ret.nossoNumero } },
          ],
        },
      })

      if (!receivable) continue

      if (ret.status === 'PAGO') {
        await prisma.accountReceivable.update({
          where: { id: receivable.id },
          data: {
            status: 'RECEBIDO',
            received_amount: ret.valorPago || receivable.total_amount,
            payment_method: 'Boleto',
            pix_code: JSON.stringify({
              ...(receivable.pix_code ? JSON.parse(receivable.pix_code) : {}),
              boletoStatus: 'PAID',
              dataCredito: ret.dataCredito?.toISOString(),
              valorPago: ret.valorPago,
            }),
          },
        })
        pagos++
      } else if (ret.status === 'REJEITADO') {
        await prisma.accountReceivable.update({
          where: { id: receivable.id },
          data: {
            boleto_url: null,
            pix_code: JSON.stringify({
              ...(receivable.pix_code ? JSON.parse(receivable.pix_code) : {}),
              boletoStatus: 'REJECTED',
              ocorrencia: ret.ocorrencia,
              ocorrenciaDescricao: ret.ocorrenciaDescricao,
            }),
          },
        })
        rejeitados++
      } else if (ret.status === 'CANCELADO') {
        await prisma.accountReceivable.update({
          where: { id: receivable.id },
          data: {
            status: 'CANCELADO',
            pix_code: JSON.stringify({
              ...(receivable.pix_code ? JSON.parse(receivable.pix_code) : {}),
              boletoStatus: 'CANCELLED',
            }),
          },
        })
        outros++
      } else {
        outros++
      }
    }

    return NextResponse.json({
      success: true,
      total: retornos.length,
      pagos,
      rejeitados,
      outros,
      detalhes: retornos.map(r => ({
        nossoNumero: r.nossoNumero,
        seuNumero: r.seuNumero,
        status: r.status,
        valorPago: r.valorPago,
        ocorrencia: r.ocorrenciaDescricao,
      })),
    })
  } catch (e: any) {
    console.error('Erro processar retorno CNAB:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
