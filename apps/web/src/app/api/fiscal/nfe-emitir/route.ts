import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { logAudit } from '@/lib/audit'
import {
  extractCertificate, isCertificateValid, signXml,
  sendSoapRequest, extractSoapBody,
  getSefazEndpoints, buildNfeXml,
  type NfeData, type NfeItem, type NfePagamento, type NfeEmitente, type NfeDestinatario,
} from '@/lib/nfe/sefaz'

/**
 * POST /api/fiscal/nfe-emitir — Emitir NF-e modelo 55 direto na SEFAZ
 *
 * Body: {
 *   customer_id: string,
 *   natureza_operacao: string,     // "VENDA DE MERCADORIA"
 *   tipo_operacao: '0' | '1',      // 0=entrada, 1=saída
 *   finalidade: '1'|'2'|'3'|'4',   // 1=normal, 4=devolução
 *   items: Array<{ product_id?, descricao, quantidade, valor_unitario, ncm, cfop, unidade }>,
 *   pagamentos: Array<{ forma, valor }>,
 *   informacoes_adicionais?: string,
 *   chaves_referenciadas?: string[],
 *   serie?: string,
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('fiscal', 'create')
    if (result instanceof NextResponse) return result
    const user = result

    const body = await req.json()
    const {
      customer_id, natureza_operacao, tipo_operacao, finalidade,
      items, pagamentos, informacoes_adicionais,
      chaves_referenciadas, serie: serieParam,
    } = body

    if (!customer_id) return error('Cliente obrigatório', 400)
    if (!items?.length) return error('Adicione pelo menos um item', 400)
    if (!pagamentos?.length) return error('Informe a forma de pagamento', 400)

    // Buscar dados do emitente (empresa)
    const company = await prisma.company.findUnique({ where: { id: user.companyId } })
    if (!company) return error('Empresa não encontrada', 500)

    const fiscalCfg = await prisma.fiscalConfig.findUnique({ where: { company_id: user.companyId } })
    if (!fiscalCfg) return error('Configuração fiscal não encontrada. Vá em Configurações > Fiscal.', 400)

    const settings = await prisma.setting.findMany({ where: { company_id: user.companyId } })
    const cfg: Record<string, string> = {}
    for (const s of settings) cfg[s.key] = s.value

    // Extrair certificado A1
    const fiscalSettings = (fiscalCfg.settings || {}) as Record<string, any>
    const certBase64 = fiscalSettings.certificate_base64
    if (!certBase64) return error('Certificado A1 não instalado. Vá em Configurações > Certificado.', 400)

    let certPassword = ''
    if (fiscalSettings.certificate_password) {
      const { decrypt } = await import('@/lib/encryption')
      certPassword = decrypt(fiscalSettings.certificate_password)
    }

    const cert = extractCertificate(certBase64, certPassword)
    if (!isCertificateValid(cert)) return error('Certificado A1 expirado', 400)

    // Buscar cliente
    const customer = await prisma.customer.findFirst({
      where: { id: customer_id, company_id: user.companyId },
    })
    if (!customer) return error('Cliente não encontrado', 404)
    if (!customer.document_number) return error('Cliente sem CPF/CNPJ', 400)

    // Buscar/incrementar número da série
    const serie = serieParam || '1'
    const nfeSerie = await prisma.$queryRawUnsafe(`
      UPDATE nfe_series SET last_number = last_number + 1, updated_at = NOW()
      WHERE company_id = '${user.companyId}' AND serie = '${serie}'
      RETURNING last_number
    `) as any[]

    let numero: number
    if (nfeSerie.length > 0) {
      numero = nfeSerie[0].last_number
    } else {
      await prisma.$executeRawUnsafe(`
        INSERT INTO nfe_series (company_id, serie, last_number) VALUES ('${user.companyId}', '${serie}', 1)
        ON CONFLICT (company_id, serie) DO UPDATE SET last_number = nfe_series.last_number + 1, updated_at = NOW()
      `)
      numero = 1
    }

    // Montar emitente
    const emitente: NfeEmitente = {
      cnpj: cfg['cnab.cnpj'] || cert.cnpj || cfg['company.cnpj'] || '',
      razaoSocial: cfg['cnab.razao_social'] || company.name,
      nomeFantasia: company.name,
      inscricaoEstadual: cfg['company.ie'] || fiscalSettings.inscricao_estadual || '',
      crt: (cfg['company.crt'] || fiscalSettings.crt || '1') as '1' | '2' | '3',
      endereco: {
        logradouro: cfg['cnab.endereco'] || cfg['company.street'] || '',
        numero: cfg['company.number'] || 'S/N',
        bairro: cfg['cnab.bairro'] || cfg['company.neighborhood'] || '',
        codigoMunicipio: cfg['company.cod_municipio'] || fiscalSettings.codigo_municipio || '3550308',
        municipio: cfg['cnab.cidade'] || cfg['company.city'] || 'SAO PAULO',
        uf: cfg['cnab.uf'] || cfg['company.state'] || 'SP',
        cep: cfg['cnab.cep'] || cfg['company.zip'] || '',
        telefone: cfg['company.phone']?.replace(/\D/g, '') || '',
      },
    }

    // Montar destinatário
    const docLimpo = customer.document_number.replace(/\D/g, '')
    const destUf = customer.address_state || emitente.endereco.uf
    const destino = destUf === emitente.endereco.uf ? '1' : '2'

    const destinatario: NfeDestinatario = {
      cpfCnpj: docLimpo,
      razaoSocial: customer.legal_name,
      inscricaoEstadual: (customer as any).inscricao_estadual || '',
      email: customer.email || undefined,
      endereco: {
        logradouro: customer.address_street || 'NAO INFORMADO',
        numero: customer.address_number || 'S/N',
        complemento: (customer as any).address_complement || undefined,
        bairro: (customer as any).address_neighborhood || 'CENTRO',
        codigoMunicipio: (customer as any).cod_municipio || '3550308',
        municipio: customer.address_city || 'SAO PAULO',
        uf: destUf,
        cep: customer.address_zip || '00000000',
      },
      indIEDest: docLimpo.length === 14 ? '1' : '9',
    }

    // Montar itens
    let totalProdutos = 0
    const nfeItems: NfeItem[] = items.map((item: any, idx: number) => {
      const valorUnit = Number(item.valor_unitario) || 0
      const qtd = Number(item.quantidade) || 1
      const valorTotal = Math.round(valorUnit * qtd * 100) / 100
      totalProdutos += valorTotal

      return {
        numero: idx + 1,
        codigoProduto: item.codigo_produto || item.product_id || String(idx + 1),
        descricao: item.descricao || '',
        ncm: item.ncm || '84433299',
        cfop: item.cfop || (destino === '1' ? (cfg['nfe.cfop_venda_interna'] || '5102') : (cfg['nfe.cfop_venda_interestadual'] || '6102')),
        unidade: item.unidade || 'UN',
        quantidade: qtd,
        valorUnitario: valorUnit,
        valorTotal,
        origemMercadoria: '0',
        csosn: emitente.crt === '1' || emitente.crt === '2' ? (cfg['nfe.csosn_padrao'] || '102') : undefined,
        cstPIS: '99',
        cstCOFINS: '99',
      }
    })

    // Montar pagamentos
    const nfePagamentos: NfePagamento[] = pagamentos.map((pag: any) => ({
      forma: pag.forma || '99',
      valor: Number(pag.valor) || totalProdutos,
    }))

    // Montar NF-e
    const ambiente = fiscalCfg.environment === 'producao' ? '1' : '2'

    const nfeData: NfeData = {
      numero,
      serie,
      ambiente: ambiente as '1' | '2',
      dataEmissao: new Date(),
      tipoOperacao: tipo_operacao || '1',
      destino: destino as '1' | '2',
      naturezaOperacao: natureza_operacao || 'VENDA DE MERCADORIA',
      finalidade: finalidade || '1',
      presencaComprador: '1',
      emitente,
      destinatario,
      items: nfeItems,
      pagamentos: nfePagamentos,
      valorProdutos: totalProdutos,
      valorNfe: totalProdutos,
      informacoesAdicionais: informacoes_adicionais,
      chavesReferenciadas: chaves_referenciadas,
    }

    // Gerar XML
    const { xml, chaveAcesso } = buildNfeXml(nfeData)
    // Assinar XML
    const signedXml = signXml(xml, cert.privateKeyPem, cert.certificatePem, 'infNFe')

    // Envelope de lote para SEFAZ — strip duplicate xmlns from NFe (already inherited from enviNFe)
    const cleanedSignedXml = signedXml.replace('<NFe xmlns="http://www.portalfiscal.inf.br/nfe">', '<NFe>')
    const loteXml = `<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><idLote>${Date.now()}</idLote><indSinc>1</indSinc>${cleanedSignedXml}</enviNFe>`

    // Log full XML for debugging (signed + lote)
    await prisma.fiscalLog.create({
      data: { company_id: user.companyId, action: 'nfe_xml_debug',
        request: { raw_xml: xml.substring(0, 4000), signed_xml: signedXml.substring(0, 4000), lote_xml: loteXml.substring(0, 4000) } as any,
      },
    }).catch(() => {})

    // Determinar endpoints SEFAZ
    const endpoints = getSefazEndpoints(emitente.endereco.uf, ambiente as '1' | '2')

    // Criar registro Invoice ANTES de enviar (para rastreabilidade)
    const invoice = await prisma.invoice.create({
      data: {
        company_id: user.companyId,
        invoice_type: 'NFE',
        invoice_number: numero,
        series: serie,
        access_key: chaveAcesso,
        customer_id: customer.id,
        status: 'PROCESSING',
        nfe_tipo: natureza_operacao,
        payment_method_nfe: nfePagamentos[0]?.forma || '99',
        source_chave: chaves_referenciadas?.[0] || null,
        nfe_referenced_keys: chaves_referenciadas || [],
        total_amount: Math.round(totalProdutos * 100),
        notes: `NF-e ${numero} Serie ${serie} - ${natureza_operacao}`,
      },
    })

    // Criar itens da invoice
    for (const item of nfeItems) {
      const matchedProduct = item.codigoProduto && item.codigoProduto.length > 10
        ? await prisma.product.findFirst({ where: { id: item.codigoProduto, company_id: user.companyId } })
        : null

      await prisma.invoiceItem.create({
        data: {
          invoice_id: invoice.id,
          product_id: matchedProduct?.id || null,
          description: item.descricao,
          quantity: item.quantidade,
          unit_price: Math.round(item.valorUnitario * 100),
          total_price: Math.round(item.valorTotal * 100),
          ncm: item.ncm,
          cfop: item.cfop,
          unidade: item.unidade,
          codigo_produto_fiscal: item.codigoProduto,
        },
      })
    }

    // Log do request
    await prisma.fiscalLog.create({
      data: {
        company_id: user.companyId,
        invoice_id: invoice.id,
        action: 'nfe_emitir',
        request: { chave: chaveAcesso, numero, serie, url: endpoints.autorizacao },
      },
    })

    // Enviar para SEFAZ
    let sefazResponse = ''
    let sefazStatus = 'PROCESSING'
    let protocolo = ''
    let motivo = ''

    try {
      sefazResponse = await sendSoapRequest({
        url: endpoints.autorizacao,
        action: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote',
        body: loteXml,
        privateKeyPem: cert.privateKeyPem,
        certificatePem: cert.certificatePem,
        timeout: 30000,
      })

      const responseBody = extractSoapBody(sefazResponse)

      // Parsear resposta — buscar cStat e xMotivo
      const cStatMatch = responseBody.match(/<cStat>(\d+)<\/cStat>/)
      const xMotivoMatch = responseBody.match(/<xMotivo>([^<]+)<\/xMotivo>/)
      const nProtMatch = responseBody.match(/<nProt>(\d+)<\/nProt>/)

      const cStat = cStatMatch?.[1] || ''
      motivo = xMotivoMatch?.[1] || ''
      protocolo = nProtMatch?.[1] || ''

      if (cStat === '100' || cStat === '104') {
        // 100 = Autorizado, 104 = Lote processado
        const cStatProt = responseBody.match(/<infProt>[\s\S]*?<cStat>(\d+)<\/cStat>/)?.[1]
        if (cStatProt === '100') {
          sefazStatus = 'AUTHORIZED'
        } else {
          sefazStatus = 'REJECTED'
          motivo = responseBody.match(/<infProt>[\s\S]*?<xMotivo>([^<]+)<\/xMotivo>/)?.[1] || motivo
        }
      } else if (cStat === '103') {
        // Lote recebido com sucesso — consultar depois
        sefazStatus = 'PROCESSING'
      } else {
        sefazStatus = 'REJECTED'
      }

      // Log da resposta
      await prisma.fiscalLog.create({
        data: {
          company_id: user.companyId,
          invoice_id: invoice.id,
          action: 'nfe_resposta',
          response: { cStat, motivo, protocolo, body: responseBody.substring(0, 2000) },
          status_code: parseInt(cStat) || 0,
        },
      })
    } catch (sefazErr: any) {
      sefazStatus = 'ERROR'
      motivo = sefazErr.message || 'Erro de comunicação com SEFAZ'

      await prisma.fiscalLog.create({
        data: {
          company_id: user.companyId,
          invoice_id: invoice.id,
          action: 'nfe_erro',
          response: { error: motivo },
          status_code: 500,
        },
      })
    }

    // Atualizar invoice com resultado
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: sefazStatus,
        provider_ref: protocolo || null,
        ...(sefazStatus === 'AUTHORIZED' ? { authorized_at: new Date(), issued_at: new Date() } : {}),
        notes: `${invoice.notes} | ${motivo}`,
      },
    })

    // Se autorizado, baixar estoque
    if (sefazStatus === 'AUTHORIZED') {
      for (const item of nfeItems) {
        const matchedProduct = item.codigoProduto && item.codigoProduto.length > 10
          ? await prisma.product.findFirst({ where: { id: item.codigoProduto, company_id: user.companyId } })
          : null

        if (matchedProduct) {
          await prisma.$transaction([
            prisma.stockMovement.create({
              data: {
                company_id: user.companyId,
                product_id: matchedProduct.id,
                movement_type: 'EXIT',
                reason: 'NF-e Venda',
                quantity: item.quantidade,
                reference_id: invoice.id,
                notes: `NF-e ${numero} - ${item.descricao}`,
                user_id: user.id,
              },
            }),
            prisma.product.update({
              where: { id: matchedProduct.id },
              data: { current_stock: { decrement: item.quantidade } },
            }),
          ])
        }
      }
    }

    logAudit({
      companyId: user.companyId,
      userId: user.id,
      module: 'fiscal',
      action: 'nfe.emitir',
      entityId: invoice.id,
      newValue: { numero, serie, chave: chaveAcesso, status: sefazStatus, protocolo, motivo },
    })

    return success({
      id: invoice.id,
      numero,
      serie,
      chave_acesso: chaveAcesso,
      status: sefazStatus,
      protocolo,
      motivo,
    }, sefazStatus === 'AUTHORIZED' ? 201 : 200)
  } catch (err) {
    return handleError(err)
  }
}
