#!/bin/bash
# extract-asterisk-le-cert.sh
# Extrai cert Let's Encrypt do Traefik (acme.json) para o volume do Asterisk.
# Idempotente: só reload se o cert mudou (compare por SHA256).
# Coolify Scheduled Task roda diariamente.
#
# Roteia DNS: pabx.pontualtech.work -> 37.27.195.163 (este host)
# Traefik renova LE automaticamente (HTTP-01) quando faltar < 30 dias.

set -euo pipefail

ACME=/data/coolify/proxy/acme.json
DOMAIN=pabx.pontualtech.work
CERT_DIR=/var/lib/docker/volumes/bdjeh6wczqhnlnuq98slpd5j_asterisk-config/_data/keys
ASTERISK_CONTAINER=asterisk-bdjeh6wczqhnlnuq98slpd5j
LOG=/var/log/extract-asterisk-le-cert.log

CRT_FILE="$CERT_DIR/asterisk.crt"
KEY_FILE="$CERT_DIR/asterisk.key"

log() { echo "$(date -Iseconds) $*" | tee -a "$LOG"; }

# Pre-flight checks
[ -r "$ACME" ] || { log "FATAL: $ACME not readable"; exit 2; }
[ -d "$CERT_DIR" ] || { log "FATAL: $CERT_DIR not found (asterisk volume missing?)"; exit 2; }

# Extract to temp files
NEW_CRT=$(mktemp)
NEW_KEY=$(mktemp)
trap "rm -f $NEW_CRT $NEW_KEY" EXIT

jq -r --arg d "$DOMAIN" '.letsencrypt.Certificates[] | select(.domain.main==$d) | .certificate' "$ACME" \
  | base64 -d > "$NEW_CRT"
jq -r --arg d "$DOMAIN" '.letsencrypt.Certificates[] | select(.domain.main==$d) | .key' "$ACME" \
  | base64 -d > "$NEW_KEY"

# Validate non-empty + parseable PEM
[ -s "$NEW_CRT" ] || { log "FATAL: extracted cert empty for $DOMAIN"; exit 3; }
[ -s "$NEW_KEY" ] || { log "FATAL: extracted key empty for $DOMAIN"; exit 3; }
openssl x509 -noout -in "$NEW_CRT" 2>/dev/null || { log "FATAL: extracted cert is invalid PEM"; exit 3; }
# Key may be RSA or EC — try both
openssl pkey -noout -in "$NEW_KEY" 2>/dev/null || { log "FATAL: extracted key is invalid PEM"; exit 3; }

# Cert validity (warn if < 7 days)
EXP_EPOCH=$(date -d "$(openssl x509 -enddate -noout -in "$NEW_CRT" | cut -d= -f2)" +%s)
NOW_EPOCH=$(date +%s)
DAYS_LEFT=$(( (EXP_EPOCH - NOW_EPOCH) / 86400 ))
if [ "$DAYS_LEFT" -lt 7 ]; then
  log "WARN: cert expires in $DAYS_LEFT days (Traefik should auto-renew)"
fi

# Compare SHA — only update if different
NEW_SHA=$(sha256sum "$NEW_CRT" | awk '{print $1}')
OLD_SHA=$(sha256sum "$CRT_FILE" 2>/dev/null | awk '{print $1}' || echo "none")

if [ "$NEW_SHA" = "$OLD_SHA" ]; then
  log "OK cert unchanged sha=$NEW_SHA days_left=$DAYS_LEFT"
  exit 0
fi

log "CERT CHANGED: $OLD_SHA -> $NEW_SHA. Installing (days_left=$DAYS_LEFT)..."

# Install with asterisk:asterisk ownership (uid 1000 inside container)
install -m 644 -o 1000 -g 1000 "$NEW_CRT" "$CRT_FILE"
install -m 640 -o 1000 -g 1000 "$NEW_KEY" "$KEY_FILE"
log "INSTALLED: $CRT_FILE ($NEW_SHA)"

# Reload Asterisk PJSIP (re-reads dtls_cert_file/dtls_private_key)
if docker ps --format '{{.Names}}' | grep -q "^${ASTERISK_CONTAINER}$"; then
  docker exec "$ASTERISK_CONTAINER" asterisk -rx "module reload res_pjsip" >>"$LOG" 2>&1
  log "RELOADED res_pjsip on $ASTERISK_CONTAINER"
else
  log "WARN: container $ASTERISK_CONTAINER not running; cert installed but not reloaded"
fi

exit 0
