#!/bin/bash
# N4 fix (audit pos-fix): script de backup pg_dump regular.
#
# Executa em sidecar Coolify ou cron externo (NÃO no boot path do ERP —
# ensure script já é defesa-em-profundidade, não DR).
#
# Uso (Coolify Scheduled Task ou crontab no host):
#   0 3 * * * /path/to/backup-pg-dump.sh   # 03:00 BRT diário
#
# Variáveis necessárias:
#   DATABASE_URL — connection string Postgres
#   BACKUP_DIR — diretório local pra salvar (volume persistente)
#   BACKUP_RETENTION_DAYS — dias de retenção (default 30)
#
# Saída:
#   $BACKUP_DIR/pontualerp-YYYY-MM-DD-HH.dump (formato custom Postgres)
#   Arquivos > BACKUP_RETENTION_DAYS dropados.
#
# RESTORE (drill recommended monthly):
#   pg_restore -d <test_db> -Fc backup.dump
#   smoke test: psql -c "SELECT count(*) FROM payments, accounts_receivable, customers"

set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[backup] DATABASE_URL não configurado" >&2
  exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-/var/backups/pontualerp}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y-%m-%d-%H)
DUMP_FILE="$BACKUP_DIR/pontualerp-${TIMESTAMP}.dump"

mkdir -p "$BACKUP_DIR"

echo "[backup] Iniciando pg_dump → $DUMP_FILE"
START=$(date +%s)

# -Fc: formato custom (compressed, restorável seletivo)
# --no-owner --no-acl: portátil entre instances
# --exclude-table-data: pular tabelas grandes que não precisam backup
#   (logs já têm retention via N33 cron)
pg_dump "$DATABASE_URL" \
  -Fc --no-owner --no-acl \
  --exclude-table-data='audit_logs' \
  --exclude-table-data='_trigger_failures' \
  --exclude-table-data='chatbot_logs' \
  --exclude-table-data='voip_audit_log' \
  -f "$DUMP_FILE"

ELAPSED=$(($(date +%s) - START))
SIZE=$(du -h "$DUMP_FILE" | cut -f1)
echo "[backup] OK $DUMP_FILE ($SIZE em ${ELAPSED}s)"

# Cleanup: dumps > RETENTION_DAYS
DELETED=$(find "$BACKUP_DIR" -name "pontualerp-*.dump" -mtime +"$RETENTION_DAYS" -print -delete | wc -l)
if [ "$DELETED" -gt 0 ]; then
  echo "[backup] Cleanup: $DELETED dumps antigos removidos (>${RETENTION_DAYS}d)"
fi

# Validação rápida (lista as tabelas no dump — sanity check)
TABLES=$(pg_restore -l "$DUMP_FILE" | grep -c "TABLE DATA")
echo "[backup] Sanity: $TABLES TABLE DATA entries no dump"

# TODO upload pra S3/Hetzner Object Storage:
# if [ -n "${S3_BUCKET:-}" ]; then
#   aws s3 cp "$DUMP_FILE" "s3://$S3_BUCKET/erp-backups/" --quiet
# fi

exit 0
