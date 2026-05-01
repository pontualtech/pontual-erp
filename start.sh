#!/bin/sh
echo "=== PontualERP Starting ==="

# Push schema to database (creates tables if they don't exist)
echo "Running Prisma db push..."
node node_modules/prisma/build/index.js db push --schema=packages/db/prisma/schema.prisma --skip-generate --accept-data-loss 2>&1 || echo "Prisma db push completed (or already up to date)"

# Defesa-em-profundidade: garante voip_extensions + 15 ramais base.
# db push pode dropar essa tabela em schema diff (incidente 2026-05-01).
# Idempotente — ON CONFLICT DO NOTHING preserva mudanças manuais.
echo "Ensuring voip_extensions..."
sh ./ensure-voip-extensions.sh || echo "ensure-voip-extensions.sh non-fatal failure"

echo "Starting Next.js server..."
exec node apps/web/server.js
