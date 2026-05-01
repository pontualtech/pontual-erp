#!/bin/sh
# ensure-voip-extensions.sh
# Garante que voip_extensions existe + tem os 15 ramais base do tenant pontualtech-001.
# Roda DEPOIS de prisma db push no start.sh — db push pode dropar a tabela em
# schema diff (já aconteceu 2026-05-01). Este script é defesa-em-profundidade.
#
# Idempotente: ON CONFLICT DO NOTHING — não sobrescreve secrets se já existe.
# Falha não-fatal: log + continua boot do Next.js (telefonia Sonax independente).

set -u

DB_URL="${DATABASE_URL:-}"
if [ -z "$DB_URL" ]; then
  echo "[ensure-voip] WARN: DATABASE_URL not set, skipping" >&2
  exit 0
fi

# Use psql via docker if not available locally — but ERP container has it via prisma deps?
# Actually ERP container doesn't ship psql. Use node + pg client (already in deps via Prisma).
# Use Prisma's executeRaw via a tiny node script.

node <<'JS'
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const ramais = [
  { number: '101', description: 'Roberto - Ramal 101',    secret: 'PIuDx9lgP6yMCx2rPgAIDXPK',     active: true },
  { number: '102', description: 'Daniela - Ramal 102',    secret: '5moiczpG2WARRfNTcMspZ',        active: true },
  { number: '103', description: 'Rafael - Ramal 103',     secret: 'Zz1mLvyGOWSnqfBnPPq7FAA',     active: true },
  { number: '104', description: 'Vitoria - Ramal 104',    secret: 'ULHeVhfwqczIIpjWhMCkBgcq',    active: true },
  { number: '105', description: 'Claudiomar - Ramal 105', secret: 'hgUc1MTedG76hkl6ktuKUD1X',    active: true },
  { number: '106', description: 'Ramal 106 (vago)',       secret: 'YRvgP5BS7OZPb7qRAcHer4f',     active: false },
  { number: '107', description: 'Ramal 107 (vago)',       secret: 'BQJdYzhQOOoXXNrNV9c3oSNX',    active: false },
  { number: '108', description: 'Ramal 108 (vago)',       secret: 'HCLNmfQlgXHG70K45nBltZep',    active: false },
  { number: '109', description: 'Ramal 109 (vago)',       secret: 'kzufhcXZXQvNC2DOpzXqxb5',     active: false },
  { number: '110', description: 'Ramal 110 (vago)',       secret: '6Yl4KepdlTfB2KjClBB7iy',      active: false },
  { number: '111', description: 'Ramal 111 (vago)',       secret: 'YfWa2oX91xc9kBcE05d3Ri',      active: false },
  { number: '112', description: 'Ramal 112 (vago)',       secret: 'V1SivT24ETpPBN045v6wYe4t',    active: false },
  { number: '113', description: 'Ramal 113 (vago)',       secret: 'Ud9AB5yBq3XKdFTgTWGwDEN0',    active: false },
  { number: '114', description: 'Ramal 114 (vago)',       secret: 'ynXadyNIPiYm5DFt3ZflJy',      active: false },
  { number: '115', description: 'Ramal 115 (vago)',       secret: 'sqQkAuf9MhXvOrD0Ya593w',      active: false },
];

(async () => {
  try {
    // Step 1: ensure table exists (idempotent via IF NOT EXISTS).
    // Even if Prisma already created it, this is a no-op. If db push DROPPED
    // it, we recreate here.
    await p.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS public.voip_extensions (
        id text NOT NULL DEFAULT (gen_random_uuid())::text PRIMARY KEY,
        company_id text NOT NULL,
        number varchar(10) NOT NULL,
        description varchar(120) NOT NULL,
        caller_id_internal varchar(120),
        user_id text,
        webrtc boolean NOT NULL DEFAULT true,
        max_contacts integer NOT NULL DEFAULT 1,
        call_limit integer NOT NULL DEFAULT 1,
        secret_plain varchar(64) NOT NULL,
        context_tag varchar(60) NOT NULL DEFAULT 'from-pontualtech',
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now(),
        CONSTRAINT voip_extensions_company_id_number_key UNIQUE (company_id, number)
      );
    `);
    await p.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_voip_extensions_active
        ON public.voip_extensions (company_id, is_active);
    `);
    await p.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_voip_extensions_user
        ON public.voip_extensions (user_id);
    `);

    // Step 2: seed 15 ramais — ON CONFLICT DO NOTHING preserva secrets se já existem.
    // Se admin tiver mudado um secret manualmente via UI, não sobrescrevemos.
    let seeded = 0;
    for (const r of ramais) {
      const result = await p.$executeRawUnsafe(`
        INSERT INTO public.voip_extensions
          (company_id, number, description, secret_plain, webrtc, is_active)
        VALUES
          ($1, $2, $3, $4, true, $5)
        ON CONFLICT (company_id, number) DO NOTHING
      `, 'pontualtech-001', r.number, r.description, r.secret, r.active);
      if (result > 0) seeded++;
    }

    const count = await p.$queryRawUnsafe(
      `SELECT count(*)::int AS c FROM public.voip_extensions WHERE company_id = $1`,
      'pontualtech-001'
    );

    console.log(`[ensure-voip] OK ramais=${count[0].c} seeded=${seeded}`);
    process.exit(0);
  } catch (e) {
    console.error('[ensure-voip] FAILED:', e.message);
    // Non-fatal — Next.js boot continues. Telefonia Sonax independente.
    process.exit(0);
  } finally {
    await p.$disconnect();
  }
})();
JS
