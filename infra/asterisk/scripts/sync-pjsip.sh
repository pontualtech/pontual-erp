#!/bin/bash
# sync-pjsip.sh
# Polls PontualERP /api/voip/admin/ramais-conf, writes ramais.conf to Asterisk volume,
# reloads res_pjsip if content changed.
#
# State-driven reconciliation: idempotent, safe to run every 60s via systemd timer.
# Self-healing: any drift (manual edit, container recreate, etc) corrected within 60s.
#
# Token: read from /etc/asterisk-sync.env (one line: TOKEN=...).
# Endpoint: https://erp.pontualtech.work/api/voip/admin/ramais-conf

set -euo pipefail

ENV_FILE=/etc/asterisk-sync.env
ENDPOINT=https://erp.pontualtech.work/api/internal/voip/ramais-conf
CONF_DIR=/var/lib/docker/volumes/bdjeh6wczqhnlnuq98slpd5j_asterisk-config/_data
RAMAIS_CONF=$CONF_DIR/ramais.conf
ASTERISK_CONTAINER=asterisk-bdjeh6wczqhnlnuq98slpd5j
LOG=/var/log/sync-pjsip.log
LOCKFILE=/var/run/sync-pjsip.lock

log() { echo "$(date -Iseconds) $*" | tee -a "$LOG"; }

# Pre-flight
[ -r "$ENV_FILE" ] || { log "FATAL: $ENV_FILE not readable"; exit 2; }
[ -d "$CONF_DIR" ] || { log "FATAL: $CONF_DIR not found (asterisk volume missing?)"; exit 2; }

# Load token (env file format: TOKEN=xyz)
# shellcheck source=/dev/null
. "$ENV_FILE"
[ -n "${TOKEN:-}" ] || { log "FATAL: TOKEN not set in $ENV_FILE"; exit 2; }

# Single-instance lock (avoid races if previous run hangs on slow network)
exec 200>"$LOCKFILE"
flock -n 200 || { log "INFO: another sync in progress, exiting"; exit 0; }

# Fetch new config to temp file with strict timeout
NEW=$(mktemp)
trap "rm -f $NEW" EXIT

HTTP_CODE=$(curl -sS -o "$NEW" -w "%{http_code}" \
  --max-time 10 \
  -H "X-Sync-Token: $TOKEN" \
  -H "Accept: text/plain" \
  "$ENDPOINT" || echo "000")

if [ "$HTTP_CODE" != "200" ]; then
  log "ERROR: HTTP $HTTP_CODE from $ENDPOINT (body: $(head -c 200 "$NEW"))"
  exit 3
fi

# Sanity check: response must contain at least one [NNN] section header
if ! grep -qE '^\[1[0-9]{2}\]' "$NEW"; then
  log "ERROR: response from ERP doesnt look like ramais.conf (no [NNN] sections found, body: $(head -c 200 "$NEW"))"
  exit 4
fi

# Compare SHA — only update + reload if changed
NEW_SHA=$(sha256sum "$NEW" | awk '{print $1}')
OLD_SHA=$(sha256sum "$RAMAIS_CONF" 2>/dev/null | awk '{print $1}' || echo "none")

if [ "$NEW_SHA" = "$OLD_SHA" ]; then
  # Quiet success — only log once per hour to avoid log spam
  MINUTE=$(date +%M)
  if [ "$MINUTE" = "00" ]; then
    log "OK ramais.conf unchanged sha=$NEW_SHA"
  fi
  exit 0
fi

log "RAMAIS CHANGED: $OLD_SHA -> $NEW_SHA. Installing..."

# Install with asterisk:asterisk ownership (uid 1000 inside container)
install -m 644 -o 1000 -g 1000 "$NEW" "$RAMAIS_CONF"
log "INSTALLED: $RAMAIS_CONF ($NEW_SHA, $(wc -l < "$RAMAIS_CONF") lines)"

# Reload PJSIP — non-disruptive to Sonax registration
if docker ps --format '{{.Names}}' | grep -q "^${ASTERISK_CONTAINER}$"; then
  RELOAD_OUTPUT=$(docker exec "$ASTERISK_CONTAINER" asterisk -rx "module reload res_pjsip" 2>&1)
  log "RELOADED res_pjsip: $RELOAD_OUTPUT"
else
  log "WARN: container $ASTERISK_CONTAINER not running; ramais.conf installed but not reloaded"
  exit 5
fi

# Verify endpoint count after reload — sanity check
ENDPOINT_COUNT=$(docker exec "$ASTERISK_CONTAINER" asterisk -rx "pjsip show endpoints" 2>&1 | grep -c '^ Endpoint:' || echo "?")
log "VERIFY: $ENDPOINT_COUNT endpoints loaded after reload"

exit 0
