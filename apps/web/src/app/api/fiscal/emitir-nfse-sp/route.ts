import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { decrypt } from '@/lib/encryption'
import { z } from 'zod'

const emitirSchema = z.object({
  customer_id: z.string(),
  service_order_id: z.string().optional(),
  description: z.string().min(1, 'Discriminação do serviço é obrigatória'),
  service_code: z.string().min(1, 'Código do serviço é obrigatório'),
  total_amount: z.number().min(1, 'Valor deve ser maior que zero'),
  aliquota_iss: z.number().optional(),
  iss_retido: z.boolean().optional(),
  notes: z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission('fiscal', 'create')
    if (auth instanceof NextResponse) return auth
    const user = auth

    const body = await req.json()
    const parsed = emitirSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 })
    }

    const { customer_id, service_order_id, description, service_code, total_amount, aliquota_iss, iss_retido, notes } = parsed.data

    // ====== BLOQUEIO: verificar se já existe NFS-e autorizada para esta OS ======
    if (service_order_id) {
      const existing = await prisma.invoice.findFirst({
        where: {
          company_id: user.companyId,
          service_order_id,
          invoice_type: 'NFSE',
          status: 'AUTHORIZED',
        },
      })
      if (existing) {
        return NextResponse.json({
          error: `Já existe NFS-e #${existing.invoice_number} autorizada para esta OS. Cancele a anterior antes de emitir nova.`,
        }, { status: 422 })
      }
    }

    // 1. Buscar config fiscal
    const config = await prisma.fiscalConfig.findUnique({
      where: { company_id: user.companyId },
    })

    if (!config) {
      return NextResponse.json({ error: 'Configure o módulo fiscal antes de emitir NFS-e' }, { status: 400 })
    }

    const settings = (config.settings || {}) as Record<string, any>

    if (!settings.certificate_base64) {
      return NextResponse.json({ error: 'Certificado A1 não instalado. Vá em Configurações > Certificado A1' }, { status: 400 })
    }

    if (!settings.cnpj || !settings.inscricaoMunicipal) {
      return NextResponse.json({ error: 'CNPJ e Inscrição Municipal são obrigatórios na configuração fiscal' }, { status: 400 })
    }

    const certPassword = settings.certificate_password ? decrypt(settings.certificate_password) : ''

    // 2. Buscar cliente
    const customer = await prisma.customer.findUnique({ where: { id: customer_id } })
    if (!customer) {
      return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 })
    }

    if (!customer.document_number) {
      return NextResponse.json({ error: 'Cliente sem CPF/CNPJ cadastrado' }, { status: 400 })
    }

    // 3. Calcular próximo número de RPS (sequencial, sem buracos)
    const lastInvoice = await prisma.invoice.findFirst({
      where: { company_id: user.companyId, invoice_type: 'NFSE', provider_name: 'prefeitura_sp' },
      orderBy: { created_at: 'desc' },
    })
    const nextRPS = lastInvoice ? (parseInt(lastInvoice.series || '0') || 0) + 1 : 1

    // 4. Criar registro da Invoice (status PROCESSING)
    const valorReais = total_amount / 100
    const ref = `SP-${Date.now()}`

    const invoice = await prisma.invoice.create({
      data: {
        company_id: user.companyId,
        invoice_type: 'NFSE',
        series: String(nextRPS),
        customer_id,
        service_order_id: service_order_id || null,
        status: 'PROCESSING',
        provider_ref: ref,
        provider_name: 'prefeitura_sp',
        total_amount,
        tax_amount: Math.round(total_amount * (aliquota_iss || 0.05)),
        notes: notes || null,
        invoice_items: {
          create: {
            service_code,
            description,
            quantity: 1,
            unit_price: total_amount,
            total_price: total_amount,
          },
        },
      },
    })

    // 5. Emitir via Prefeitura SP
    const { emitirNfseSP } = await import('@/lib/nfse/prefeitura-sp')
    const spConfig = {
      environment: (config.environment as 'homologacao' | 'producao') || 'producao',
      cnpj: settings.cnpj,
      inscricaoMunicipal: settings.inscricaoMunicipal,
      certificateBase64: settings.certificate_base64,
      certificatePassword: certPassword,
    }

    const resultado = await emitirNfseSP(
      {
        numero_rps: nextRPS,
        valor_servicos: valorReais,
        valor_deducoes: 0,
        codigo_servico: service_code,
        aliquota_iss: aliquota_iss || parseFloat(settings.aliquotaISS || '0.05'),
        iss_retido: iss_retido || false,
        discriminacao: description,
        tomador_cpf_cnpj: customer.document_number,
        tomador_razao_social: customer.legal_name,
        tomador_email: customer.email || undefined,
        tomador_logradouro: customer.address_street || undefined,
        tomador_numero: customer.address_number || undefined,
        tomador_bairro: customer.address_neighborhood || undefined,
        tomador_cidade: undefined, // omitir endereço — evita erro CEP/município
        tomador_uf: customer.address_state || 'SP',
        tomador_cep: customer.address_zip || undefined,
      },
      {
        cnpj: settings.cnpj,
        inscricao_municipal: settings.inscricaoMunicipal,
        codigo_municipio: settings.codigoMunicipio || '3550308',
      },
      spConfig
    )

    // 6. Registrar log
    await prisma.fiscalLog.create({
      data: {
        company_id: user.companyId,
        invoice_id: invoice.id,
        action: 'emitir_nfse_sp',
        request: { input: parsed.data, rps: nextRPS } as any,
        response: {
          sucesso: resultado.sucesso,
          status: resultado.status,
          numero_nfse: resultado.numero_nfse,
          erros: resultado.erros,
          xml_resposta: resultado.xml_resposta?.substring(0, 2000),
        } as any,
        status_code: resultado.sucesso ? 200 : 400,
      },
    })

    // 7. Atualizar invoice com resultado
    if (resultado.sucesso) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: 'AUTHORIZED',
          invoice_number: resultado.numero_nfse ? parseInt(resultado.numero_nfse) : null,
          access_key: resultado.codigo_verificacao,
          danfe_url: resultado.link_nfse,
          issued_at: new Date(),
          authorized_at: new Date(),
        },
      })

      // 8. ENVIAR NFS-e POR EMAIL ao cliente automaticamente
      if (customer.email && resultado.link_nfse) {
        try {
          const { sendEmail } = await import('@/lib/send-email')

          // Buscar nome da empresa
          const company = await prisma.company.findUnique({
            where: { id: user.companyId },
            select: { name: true },
          })

          await sendEmail(
            customer.email,
            `NFS-e #${resultado.numero_nfse} - ${company?.name || 'ERP'}`,
            `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #1a1a1a;">Nota Fiscal de Servico Eletronica</h2>
                <p>Prezado(a) <strong>${customer.legal_name}</strong>,</p>
                <p>Segue sua NFS-e referente ao servico prestado:</p>
                <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                  <tr style="background: #f8f9fa;">
                    <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>NFS-e Numero</strong></td>
                    <td style="padding: 10px; border: 1px solid #dee2e6;">${resultado.numero_nfse}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>Codigo Verificacao</strong></td>
                    <td style="padding: 10px; border: 1px solid #dee2e6;">${resultado.codigo_verificacao}</td>
                  </tr>
                  <tr style="background: #f8f9fa;">
                    <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>Valor</strong></td>
                    <td style="padding: 10px; border: 1px solid #dee2e6;">R$ ${valorReais.toFixed(2)}</td>
                  </tr>
                </table>
                <p><strong>Discriminacao:</strong></p>
                <p style="background: #f8f9fa; padding: 12px; border-radius: 4px; font-size: 14px;">${description}</p>
                <p style="margin-top: 20px;">
                  <a href="${resultado.link_nfse}" style="display: inline-block; background: #7c3aed; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">
                    Visualizar NFS-e
                  </a>
                </p>
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;" />
                <p style="font-size: 12px; color: #888;">${company?.name || 'ERP'} — Nota Fiscal emitida eletronicamente pela Prefeitura de Sao Paulo</p>
              </div>
            `
          )
        } catch (emailErr: any) {
          // Não bloquear emissão se email falhar — logar apenas
          console.error('Erro ao enviar email NFS-e:', emailErr.message)
        }
      }
    } else {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: 'REJECTED',
          notes: resultado.erros?.map(e => `[${e.codigo}] ${e.mensagem}`).join('; '),
        },
      })
    }

    return NextResponse.json({
      success: resultado.sucesso,
      invoice_id: invoice.id,
      numero_nfse: resultado.numero_nfse,
      codigo_verificacao: resultado.codigo_verificacao,
      link_nfse: resultado.link_nfse,
      status: resultado.sucesso ? 'AUTHORIZED' : 'REJECTED',
      erros: resultado.erros,
    })
  } catch (e: any) {
    console.error('ERRO emitir-nfse-sp:', e)
    return NextResponse.json({ success: false, error: e.message || 'Erro interno ao emitir NFS-e' }, { status: 500 })
  }
}
