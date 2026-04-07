import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@pontual/db'
import { requirePermission } from '@/lib/auth'
import { success, error, handleError } from '@/lib/api-response'
import { parseStringPromise } from 'xml2js'

/**
 * POST /api/fiscal/nfe-recebidas/import-xml
 * Importar NF-e a partir de arquivos XML (nota fiscal estadual recebida)
 */
export async function POST(req: NextRequest) {
  try {
    const result = await requirePermission('fiscal', 'create')
    if (result instanceof NextResponse) return result
    const user = result

    const formData = await req.formData()
    const files = formData.getAll('files') as File[]

    if (!files || files.length === 0) {
      return error('Nenhum arquivo XML enviado', 400)
    }

    let importedCount = 0
    const errors: string[] = []

    for (const file of files) {
      const fileName = file.name || 'unknown.xml'

      try {
        const xmlText = await file.text()

        if (!xmlText.trim()) {
          errors.push(`${fileName}: arquivo vazio`)
          continue
        }

        const parsed = await parseStringPromise(xmlText, {
          explicitArray: false,
          ignoreAttrs: false,
          tagNameProcessors: [],
        })

        // Navigate to infNFe — handle both nfeProc.NFe.infNFe and NFe.infNFe
        let infNFe: any = null
        let protNFe: any = null

        if (parsed.nfeProc) {
          const nfe = parsed.nfeProc.NFe
          infNFe = nfe?.infNFe
          protNFe = parsed.nfeProc.protNFe
        } else if (parsed.NFe) {
          infNFe = parsed.NFe.infNFe
        }

        if (!infNFe) {
          errors.push(`${fileName}: estrutura XML invalida (infNFe nao encontrado)`)
          continue
        }

        // Extract chave_nfe
        let chave = ''
        // Try from @_Id attribute (remove "NFe" prefix)
        const idAttr = infNFe.$?.Id || infNFe.$?.id || ''
        if (idAttr) {
          chave = idAttr.replace(/^NFe/, '')
        }
        // Fallback: from protNFe
        if (!chave && protNFe) {
          const infProt = protNFe.infProt
          chave = infProt?.chNFe || ''
        }

        if (!chave || chave.length !== 44) {
          errors.push(`${fileName}: chave NF-e invalida ou nao encontrada (${chave.length} digitos)`)
          continue
        }

        const ide = infNFe.ide || {}
        const emit = infNFe.emit || {}
        const total = infNFe.total || {}
        const icmsTot = total.ICMSTot || {}

        // Extract fields
        const numero = parseInt(ide.nNF) || null
        const serie = ide.serie || null
        const dhEmi = ide.dhEmi || null
        const cnpjEmitente = emit.CNPJ || emit.cnpj || null
        const nomeEmitente = emit.xNome || null
        const vNF = icmsTot.vNF || '0'
        const valorTotal = Math.round(parseFloat(vNF) * 100)

        // Extract items from det array
        let detArray = infNFe.det
        if (!detArray) {
          detArray = []
        } else if (!Array.isArray(detArray)) {
          detArray = [detArray]
        }

        const items = detArray.map((det: any) => {
          const prod = det.prod || {}
          return {
            numero_item: det.$?.nItem || null,
            descricao: prod.xProd || '',
            ncm: prod.NCM || '',
            cfop: prod.CFOP || '',
            quantidade: parseFloat(prod.qCom || '0'),
            valor_unitario: parseFloat(prod.vUnCom || '0'),
            valor_total: parseFloat(prod.vProd || '0'),
          }
        })

        // Determine situacao from protNFe if available
        let situacao = 'pendente'
        if (protNFe?.infProt) {
          const cStat = protNFe.infProt.cStat
          if (cStat === '100') situacao = 'autorizada'
          else if (cStat === '101' || cStat === '135') situacao = 'cancelada'
          else if (cStat === '110' || cStat === '301' || cStat === '302') situacao = 'denegada'
        }

        // Upsert into database
        await prisma.nfeRecebida.upsert({
          where: {
            company_id_chave_nfe: {
              company_id: user.companyId,
              chave_nfe: chave,
            },
          },
          create: {
            company_id: user.companyId,
            chave_nfe: chave,
            numero,
            serie,
            cnpj_emitente: cnpjEmitente,
            nome_emitente: nomeEmitente,
            valor_total: valorTotal,
            data_emissao: dhEmi ? new Date(dhEmi) : null,
            situacao,
            xml_data: { xml: xmlText.substring(0, 100000) },
            items_data: items,
          },
          update: {
            numero: numero || undefined,
            serie: serie || undefined,
            cnpj_emitente: cnpjEmitente || undefined,
            nome_emitente: nomeEmitente || undefined,
            valor_total: valorTotal || undefined,
            data_emissao: dhEmi ? new Date(dhEmi) : undefined,
            situacao: situacao !== 'pendente' ? situacao : undefined,
            xml_data: { xml: xmlText.substring(0, 100000) },
            items_data: items,
            updated_at: new Date(),
          },
        })

        importedCount++
      } catch (parseErr: any) {
        errors.push(`${fileName}: ${parseErr.message || 'erro ao processar XML'}`)
      }
    }

    return success({ imported: importedCount, errors })
  } catch (err) {
    return handleError(err)
  }
}
