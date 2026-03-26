#!/bin/sh
echo "=== PontualERP Starting ==="

# Push schema to database (creates tables if they don't exist)
echo "Running Prisma db push..."
npx prisma db push --schema=packages/db/prisma/schema.prisma --skip-generate --accept-data-loss 2>&1 || echo "Prisma db push failed (may already be up to date)"

echo "Starting Next.js server..."
exec node apps/web/server.js
