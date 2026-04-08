/**
 * Cria templates de notificação automática (message_templates)
 * para os diferentes triggers de OS.
 *
 * Uso: node create-notification-templates.js
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const COMPANY_ID = 'pontualtech-001';

const templates = [
  {
    trigger: 'coleta',
    channel: 'whatsapp',
    template: `Ola {{customer_name}}! Tudo bem?

OS {{os_numbers}} aberta com sucesso!
Seu agendamento ja esta com nossa logistica.

Equipamentos para coleta:
{{equipment_list}}

A coleta ocorrera durante o horario comercial (09:00 as 17:00).
Como seguimos uma rota, nao ha horario fixo, entao deixe alguem avisado!

Mantenha com voce: cabos de energia e fontes.
Pode enviar o equipamento com os toners/cartuchos dentro.

Fique de olho no seu e-mail para os orcamentos!

Acompanhe sua OS: {{portal_url}}

Precisando de algo: {{company_phone}}
{{whatsapp_url}}

Obrigado pela confianca!
{{company_name}}`,
  },
  {
    trigger: 'equipamento_pronto',
    channel: 'whatsapp',
    template: `Ola {{customer_name}}! Tudo bem?

Temos uma otima noticia! Seu equipamento {{equipment}} (OS #{{os_number}}) esta pronto!

{{instrucao_retirada}}

Acompanhe pelo portal: {{portal_url}}

Precisando de algo:
{{company_phone}}
{{whatsapp_url}}

Obrigado pela confianca!
{{company_name}}`,
  },
  {
    trigger: 'equipamento_pronto',
    channel: 'email',
    template: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333;">
  <div style="background:linear-gradient(135deg,#2563eb,#1d4ed8);padding:28px;border-radius:12px 12px 0 0;text-align:center;">
    <p style="margin:0;font-size:40px;">🎉</p>
    <h1 style="color:#fff;margin:8px 0 0;font-size:22px;">Equipamento Pronto!</h1>
  </div>
  <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:28px;border-radius:0 0 12px 12px;">
    <p style="font-size:16px;margin:0 0 16px;">Ola <strong>{{customer_name}}</strong>,</p>
    <p style="font-size:14px;color:#555;margin:0 0 20px;line-height:1.6;">
      Temos uma otima noticia! O reparo do seu equipamento foi concluido com sucesso!
    </p>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:0 0 20px;">
      <table style="width:100%;font-size:14px;color:#166534;">
        <tr><td style="padding:4px 0;font-weight:600;">Equipamento:</td><td>{{equipment}}</td></tr>
        <tr><td style="padding:4px 0;font-weight:600;">OS:</td><td>#{{os_number}}</td></tr>
        <tr><td style="padding:4px 0;font-weight:600;">Status:</td><td style="font-weight:700;color:#16a34a;">Pronto</td></tr>
      </table>
    </div>
    <div style="text-align:center;margin:0 0 16px;">
      <a href="{{portal_url}}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Acompanhar minha OS</a>
    </div>
    <div style="border-top:1px solid #e5e7eb;padding-top:16px;">
      <p style="font-size:13px;color:#555;margin:0 0 4px;">{{company_name}}</p>
      <p style="font-size:12px;color:#999;margin:0;">Tel: {{company_phone}}</p>
    </div>
  </div>
</div>`,
  },
  {
    trigger: 'aprovacao_cliente',
    channel: 'whatsapp',
    template: `Ola {{customer_name}}!

O orcamento da sua OS #{{os_number}} ({{equipment}}) esta pronto!

Valor total: {{total_cost}}
{{installment_info}}

Voce pode aprovar diretamente pelo link:
{{approval_link}}

Ou fale conosco:
{{company_phone}}
{{whatsapp_url}}

Validade do orcamento: {{quote_validity}}

{{company_name}}`,
  },
  {
    trigger: 'quote_email',
    channel: 'email',
    template: '', // Usa o DEFAULT_QUOTE_TEMPLATE do enviar-orcamento (ja existe inline)
  },
  {
    trigger: 'entrega_realizada',
    channel: 'whatsapp',
    template: `Ola {{customer_name}}!

Seu equipamento {{equipment}} (OS #{{os_number}}) foi entregue com sucesso!

Garantia: 90 dias sobre o servico executado.
Guarde o numero da OS para acionar a garantia se necessario.

Obrigado pela confianca!
{{company_name}}
{{company_phone}}`,
  },
  {
    trigger: 'quote_approval_reminder',
    channel: 'email',
    template: '', // Usa o DEFAULT_QUOTE_REMINDER_TEMPLATE do lembrete-orcamento (ja existe inline)
  },
];

async function main() {
  console.log('=== Criando templates de notificacao ===\n');

  // Listar existentes
  const existing = await p.messageTemplate.findMany({
    where: { company_id: COMPANY_ID },
  });
  console.log(`Templates existentes: ${existing.length}`);
  for (const t of existing) {
    console.log(`  - ${t.trigger} / ${t.channel} (${t.id}) active=${t.is_active}`);
  }
  console.log('');

  let created = 0;
  let skipped = 0;

  for (const tpl of templates) {
    // Pular templates vazios (são defaults inline no código)
    if (!tpl.template) {
      console.log(`  SKIP (default inline): ${tpl.trigger} / ${tpl.channel}`);
      skipped++;
      continue;
    }

    const exists = existing.find(e => e.trigger === tpl.trigger && e.channel === tpl.channel);
    if (exists) {
      console.log(`  JA EXISTE: ${tpl.trigger} / ${tpl.channel} (${exists.id})`);
      skipped++;
      continue;
    }

    await p.messageTemplate.create({
      data: {
        company_id: COMPANY_ID,
        trigger: tpl.trigger,
        channel: tpl.channel,
        template: tpl.template,
        is_active: true,
      },
    });
    console.log(`  CRIADO: ${tpl.trigger} / ${tpl.channel}`);
    created++;
  }

  console.log(`\n=== Resultado: ${created} criados, ${skipped} pulados ===`);

  // Verificacao final
  const final = await p.messageTemplate.findMany({
    where: { company_id: COMPANY_ID },
    orderBy: [{ trigger: 'asc' }, { channel: 'asc' }],
  });
  console.log(`\nTemplates finais (${final.length}):`);
  for (const t of final) {
    console.log(`  ${t.trigger} / ${t.channel} — ${t.is_active ? 'ativo' : 'inativo'} — ${t.template.substring(0, 50)}...`);
  }

  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
