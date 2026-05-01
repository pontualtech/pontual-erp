#!/bin/sh
echo "=== PontualERP Starting ==="

# Push schema to database (creates tables if they don't exist)
echo "Running Prisma db push..."
node node_modules/prisma/build/index.js db push --schema=packages/db/prisma/schema.prisma --skip-generate --accept-data-loss 2>&1 || echo "Prisma db push completed (or already up to date)"

# Apply financeiro v2 extras (RLS policies, triggers, MV, generated columns, seed).
# Idempotente — pode rodar 1000x. Inclui tudo que Prisma db push não suporta.
# Spec: squads/financeiro-restructure-spec/output/architecture-spec.md
if [ -f scripts/apply-financeiro-extras.sql ]; then
  echo "Applying financeiro v2 extras (RLS, triggers, MV)..."
  node node_modules/prisma/build/index.js db execute \
    --file scripts/apply-financeiro-extras.sql \
    --schema packages/db/prisma/schema.prisma 2>&1 \
    && echo "Financeiro extras applied OK" \
    || echo "WARN: financeiro extras script failed — check logs above"
fi

echo "Starting Next.js server..."
exec node apps/web/server.js
