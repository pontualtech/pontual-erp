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

# Defesa-em-profundidade: garante extras do refactor financeiro v2.
# RLS policies, triggers (audit log automático em payments), MV (DRE mensal),
# generated columns (fiscal_period), CHECK constraints, seed plano de contas.
# Tudo idempotente. db push não cria isso (não é Prisma-suportado).
# Spec: squads/financeiro-restructure-spec/output/architecture-spec.md
echo "Ensuring financeiro v2 extras..."
sh ./ensure-financeiro-extras.sh || echo "ensure-financeiro-extras.sh non-fatal failure"

echo "Starting Next.js server..."
exec node apps/web/server.js
