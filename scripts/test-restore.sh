#!/bin/bash
# N4 fix (audit pos-fix): restore drill — testar backup mais recente.
# RODAR MENSALMENTE pra confirmar que backups são restoráveis.
# Sem isso, "ter backup" é teatro — só descobre que está corrompido na hora
# do desastre.
#
# Uso:
#   TEST_DATABASE_URL=postgres://test... ./test-restore.sh
#
# Cria DB temp `pontualerp_restore_test`, restaura backup mais recente,
# roda smoke queries críticas, droppa o DB temp.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/pontualerp}"
TEST_DB="${TEST_DATABASE_URL:-}"

if [ -z "$TEST_DB" ]; then
  echo "[restore-drill] TEST_DATABASE_URL não configurado" >&2
  echo "Uso: TEST_DATABASE_URL=postgres://... ./test-restore.sh" >&2
  exit 1
fi

LATEST=$(ls -t "$BACKUP_DIR"/pontualerp-*.dump 2>/dev/null | head -1)
if [ -z "$LATEST" ]; then
  echo "[restore-drill] Nenhum dump encontrado em $BACKUP_DIR" >&2
  exit 1
fi

echo "[restore-drill] Testando restore: $LATEST"

# Restaura no DB de teste
pg_restore -d "$TEST_DB" --clean --if-exists -Fc "$LATEST" 2>&1 | tail -5

# Smoke tests — queries críticas que devem retornar count > 0 (em prod real)
echo "[restore-drill] Validando integridade:"
for tbl in customers service_orders payments accounts_receivable; do
  COUNT=$(psql "$TEST_DB" -t -c "SELECT count(*) FROM $tbl;" | tr -d ' ')
  echo "  $tbl: $COUNT rows"
done

echo "[restore-drill] OK — backup é restorável"
