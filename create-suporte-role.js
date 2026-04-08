/**
 * Cria a role "Suporte" para a empresa PontualTech
 * com permissoes: os.view, clientes.view, clientes.edit, dashboard.view, core.view
 *
 * Uso: node create-suporte-role.js
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const COMPANY_ID = 'pontualtech-001';
const ROLE_NAME = 'Suporte';

const REQUIRED_PERMISSIONS = [
  { module: 'os', action: 'view' },
  { module: 'clientes', action: 'view' },
  { module: 'clientes', action: 'edit' },
  { module: 'dashboard', action: 'view' },
  { module: 'core', action: 'view' },
];

async function main() {
  console.log('=== Criando role Suporte ===\n');

  // 1. Verificar se ja existe
  const existing = await p.role.findFirst({
    where: { company_id: COMPANY_ID, name: ROLE_NAME },
  });
  if (existing) {
    console.log(`Role "${ROLE_NAME}" ja existe (id: ${existing.id}). Pulando criacao.`);
  }

  // 2. Listar roles existentes para referencia
  const roles = await p.role.findMany({
    where: { company_id: COMPANY_ID },
    include: { role_permissions: { include: { permissions: true } } },
  });
  console.log('Roles existentes:');
  for (const r of roles) {
    const perms = r.role_permissions.map(rp => `${rp.permissions.module}.${rp.permissions.action}`).join(', ');
    console.log(`  - ${r.name} (${r.id}): ${perms || 'sem permissoes'}`);
  }

  // 3. Buscar/criar permissoes necessarias
  console.log('\nPermissoes necessarias:');
  const permissionIds = [];
  for (const { module, action } of REQUIRED_PERMISSIONS) {
    let perm = await p.permission.findFirst({
      where: { module, action },
    });
    if (!perm) {
      perm = await p.permission.create({
        data: {
          module,
          action,
          description: `${module}.${action}`,
        },
      });
      console.log(`  CRIADA: ${module}.${action} (${perm.id})`);
    } else {
      console.log(`  OK: ${module}.${action} (${perm.id})`);
    }
    permissionIds.push(perm.id);
  }

  // 4. Criar role
  let role = existing;
  if (!role) {
    role = await p.role.create({
      data: {
        company_id: COMPANY_ID,
        name: ROLE_NAME,
        description: 'Atendimento ao cliente — visualiza OS, edita clientes, acessa dashboard',
        is_active: true,
      },
    });
    console.log(`\nRole criada: ${role.name} (${role.id})`);
  }

  // 5. Criar role_permissions (idempotente)
  let created = 0;
  let skipped = 0;
  for (const permId of permissionIds) {
    const existingRP = await p.rolePermission.findFirst({
      where: { role_id: role.id, permission_id: permId },
    });
    if (existingRP) {
      skipped++;
      continue;
    }
    await p.rolePermission.create({
      data: {
        company_id: COMPANY_ID,
        role_id: role.id,
        permission_id: permId,
        granted: true,
      },
    });
    created++;
  }
  console.log(`\nRole permissions: ${created} criadas, ${skipped} ja existiam`);

  // 6. Verificacao final
  const finalRole = await p.role.findFirst({
    where: { id: role.id },
    include: { role_permissions: { include: { permissions: true } } },
  });
  const finalPerms = finalRole.role_permissions.map(rp => `${rp.permissions.module}.${rp.permissions.action}`).join(', ');
  console.log(`\n=== Resultado final ===`);
  console.log(`Role: ${finalRole.name} (${finalRole.id})`);
  console.log(`Permissoes: ${finalPerms}`);

  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
