const { PrismaClient } = require('@prisma/client');
const cr = require('crypto');
const https = require('https');
const forge = require('node-forge');
const { SignedXml } = require('xml-crypto');
const p = new PrismaClient();

function getKey() { return cr.scryptSync(process.env.ENCRYPTION_KEY, process.env.ENCRYPTION_SALT, 32); }
function decrypt(t) { const [iv,at,enc]=t.split(':'); const d=cr.createDecipheriv('aes-256-gcm',getKey(),Buffer.from(iv,'hex')); d.setAuthTag(Buffer.from(at,'hex')); return d.update(enc,'hex','utf8')+d.final('utf8'); }
function pad(v,l,c='0',s='left'){return s==='right'?String(v).padEnd(l,c):String(v).padStart(l,c);}

async function emitir() {
  const os = await p.serviceOrder.findFirst({ where: { os_number: 53921 }, include: { customers: true, service_order_items: { where: { deleted_at: null } } } });
  const cfg = await p.fiscalConfig.findFirst({ where: { company_id: 'pontualtech-001' } });
  const s = cfg.settings;
  const certPw = decrypt(s.certificate_password);
  const p12obj = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.decode64(s.certificate_base64)), certPw);
  const keyPem = forge.pki.privateKeyToPem(p12obj.getBags({bagType:forge.pki.oids.pkcs8ShroudedKeyBag})[forge.pki.oids.pkcs8ShroudedKeyBag][0].key);
  const certPem = forge.pki.certificateToPem(p12obj.getBags({bagType:forge.pki.oids.certBag})[forge.pki.oids.certBag][0].cert);
  const certClean = certPem.replace('-----BEGIN CERTIFICATE-----','').replace('-----END CERTIFICATE-----','').replace(/\r?\n/g,'');

  const lastInv = await p.invoice.findFirst({ where: { company_id: 'pontualtech-001', invoice_type: 'NFSE', provider_name: 'prefeitura_sp' }, orderBy: { created_at: 'desc' } });
  const nextRPS = lastInv ? (parseInt(lastInv.series || '0') || 0) + 1 : 1;

  const valorCentavos = os.total_cost;
  const valorReais = valorCentavos / 100;
  const cpf = os.customers.document_number;
  const itensDesc = os.service_order_items.map(i => i.description + ' (' + i.quantity + 'x R$ ' + (i.unit_price/100).toFixed(2) + ')').join('; ');
  const discriminacao = 'Reparo em ' + (os.equipment_type||'Impressora') + ' marca ' + (os.equipment_brand||'') + ' modelo ' + (os.equipment_model||'') + ', numero de serie ' + (os.serial_number||'N/A') + ', conforme OS ' + os.os_number + '. Servicos: ' + itensDesc + '. Garantia 90 dias.';

  console.log('OS:', os.os_number, '| Cliente:', os.customers.legal_name, '| Valor: R$', valorReais.toFixed(2));
  console.log('Discriminacao:', discriminacao);
  console.log('RPS:', nextRPS);

  const hashStr = pad(s.inscricaoMunicipal,8)+pad('NF',5,' ','right')+pad(nextRPS,12)+'20260331'+'T'+'N'+'N'+pad(valorCentavos,15)+pad(0,15)+pad('07498',5)+'1'+pad(cpf,14);
  const rpsSign = cr.createSign('RSA-SHA1'); rpsSign.update(hashStr,'ascii');

  let xml = '<PedidoEnvioRPS xmlns="http://www.prefeitura.sp.gov.br/nfe">';
  xml += '<Cabecalho xmlns="" Versao="1"><CPFCNPJRemetente><CNPJ>'+s.cnpj+'</CNPJ></CPFCNPJRemetente></Cabecalho>';
  xml += '<RPS xmlns=""><Assinatura>'+rpsSign.sign(keyPem,'base64')+'</Assinatura>';
  xml += '<ChaveRPS><InscricaoPrestador>'+pad(s.inscricaoMunicipal,8)+'</InscricaoPrestador><SerieRPS>NF</SerieRPS><NumeroRPS>'+nextRPS+'</NumeroRPS></ChaveRPS>';
  xml += '<TipoRPS>RPS</TipoRPS><DataEmissao>2026-03-31</DataEmissao><StatusRPS>N</StatusRPS><TributacaoRPS>T</TributacaoRPS>';
  xml += '<ValorServicos>'+valorReais.toFixed(2)+'</ValorServicos><ValorDeducoes>0.00</ValorDeducoes>';
  xml += '<CodigoServico>07498</CodigoServico><AliquotaServicos>0.0500</AliquotaServicos><ISSRetido>false</ISSRetido>';
  xml += '<CPFCNPJTomador><CPF>'+cpf+'</CPF></CPFCNPJTomador>';
  xml += '<RazaoSocialTomador>'+os.customers.legal_name+'</RazaoSocialTomador>';
  xml += '<EmailTomador>'+os.customers.email+'</EmailTomador>';
  xml += '<Discriminacao>'+discriminacao.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</Discriminacao>';
  xml += '</RPS></PedidoEnvioRPS>';

  const sig = new SignedXml({privateKey:keyPem,canonicalizationAlgorithm:'http://www.w3.org/2001/10/xml-exc-c14n#',signatureAlgorithm:'http://www.w3.org/2000/09/xmldsig#rsa-sha1',idMode:'wssecurity'});
  sig.addReference({xpath:'/*',digestAlgorithm:'http://www.w3.org/2000/09/xmldsig#sha1',transforms:['http://www.w3.org/2000/09/xmldsig#enveloped-signature','http://www.w3.org/2001/10/xml-exc-c14n#'],uri:'',isEmptyUri:true});
  sig.getKeyInfoContent = () => '<X509Data><X509Certificate>'+certClean+'</X509Certificate></X509Data>';
  sig.computeSignature(xml,{location:{reference:'/*',action:'append'}});
  let xmlAssinado = sig.getSignedXml().replace(/ Id="[^"]*"/g,'');

  const soap = '<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><EnvioRPSRequest xmlns="http://www.prefeitura.sp.gov.br/nfe"><VersaoSchema>1</VersaoSchema><MensagemXML><![CDATA['+xmlAssinado+']]></MensagemXML></EnvioRPSRequest></soap:Body></soap:Envelope>';

  console.log('\nEmitindo NFS-e na Prefeitura de SP...');

  return new Promise(r=>{
    const req=https.request({hostname:'nfe.prefeitura.sp.gov.br',port:443,path:'/ws/lotenfe.asmx',method:'POST',headers:{'Content-Type':'text/xml; charset=utf-8','Content-Length':Buffer.byteLength(soap),'SOAPAction':'http://www.prefeitura.sp.gov.br/nfe/ws/envioRPS'},key:keyPem,cert:certPem,rejectUnauthorized:false},res=>{
      const ch=[];res.on('data',c=>ch.push(c));res.on('end',async ()=>{
        const body=Buffer.concat(ch).toString('utf8').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
        const sucesso = body.includes('<Sucesso>true');
        const nf = body.match(/<NumeroNFe>(\d+)/);
        const cod = body.match(/<CodigoVerificacao>(\w+)/);

        if (sucesso) {
          const numNfse = nf?.[1];
          const codVerif = cod?.[1];
          const link = 'https://nfe.prefeitura.sp.gov.br/contribuinte/notaprint.aspx?ccm=61899534&nf='+numNfse+'&cod='+codVerif;

          console.log('\n========================================');
          console.log('   NFS-e EMITIDA COM SUCESSO!');
          console.log('========================================');
          console.log('Numero:', numNfse);
          console.log('Codigo Verificacao:', codVerif);
          console.log('Valor: R$', valorReais.toFixed(2));
          console.log('Cliente:', os.customers.legal_name);
          console.log('Link:', link);

          await p.invoice.create({ data: {
            company_id: 'pontualtech-001',
            invoice_type: 'NFSE',
            series: String(nextRPS),
            customer_id: os.customers.id,
            service_order_id: os.id,
            status: 'AUTHORIZED',
            provider_ref: 'SP-' + Date.now(),
            provider_name: 'prefeitura_sp',
            total_amount: valorCentavos,
            tax_amount: Math.round(valorCentavos * 0.05),
            invoice_number: parseInt(numNfse),
            access_key: codVerif,
            danfe_url: link,
            issued_at: new Date(),
            authorized_at: new Date(),
            invoice_items: { create: {
              service_code: '07498',
              description: discriminacao,
              quantity: 1,
              unit_price: valorCentavos,
              total_price: valorCentavos,
            }},
          }});
          console.log('Registrado no ERP!');
        } else {
          const erro = body.match(/<Descricao>(.*?)<\/Descricao>/g);
          console.log('ERRO:', erro?.join('; ') || body.substring(0,500));
        }
        await p.$disconnect();
        r(null);
      });
    });
    req.on('error',e=>{console.error(e.message);r(null);});
    req.write(soap);req.end();
  });
}
emitir();
