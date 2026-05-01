#!/bin/bash
# monitor-asterisk.sh
# Health check do Asterisk PontualPABX. Roda a cada 5min via systemd timer.
#
# Verifica:
#   1. Container asterisk-* está Up
#   2. Sonax outbound registration OK (Registered, exp >0s)
#   3. PJSIP transport-ws ativo
#   4. >=15 endpoints WebRTC carregados
#
# Falhas geram exit !=0 e log estruturado.
# Alertas: se /etc/asterisk-monitor.env tiver TELEGRAM_BOT_TOKEN+TELEGRAM_CHAT_ID,
# envia mensagem. Caso contrário só loga (systemd OnFailure pode encaminhar pra email).

set -uo pipefail  # NOT -e: queremos continuar checando todos os itens, não abortar no 1º fail

ENV_FILE=/etc/asterisk-monitor.env
ASTERISK_CONTAINER=asterisk-bdjeh6wczqhnlnuq98slpd5j
LOG=/var/log/monitor-asterisk.log
ALERT_STATE=/var/lib/monitor-asterisk-alert-state

# Carrega creds opcionais (nao falha se nao tem)
[ -r "$ENV_FILE" ] && . "$ENV_FILE"

log() { echo "$(date -Iseconds) $*" | tee -a "$LOG"; }

errors=()

# --- Check 1: container running
if ! docker ps --format '{{.Names}}' | grep -q "^${ASTERISK_CONTAINER}$"; then
  errors+=("CONTAINER_DOWN: $ASTERISK_CONTAINER not in docker ps")
fi

# Only run Asterisk-internal checks if container is up
if [ ${#errors[@]} -eq 0 ]; then
  # --- Check 2: container health (docker healthcheck)
  HEALTH=$(docker inspect --format '{{.State.Health.Status}}' "$ASTERISK_CONTAINER" 2>/dev/null || echo "unknown")
  if [ "$HEALTH" != "healthy" ]; then
    errors+=("CONTAINER_UNHEALTHY: docker health=$HEALTH")
  fi

  # --- Check 3: Sonax registration
  REG_OUT=$(docker exec "$ASTERISK_CONTAINER" asterisk -rx "pjsip show registrations" 2>&1)
  if ! echo "$REG_OUT" | grep -qE 'sonax-reg.*Registered'; then
    errors+=("SONAX_NOT_REGISTERED: $(echo "$REG_OUT" | grep -E 'sonax-reg' | head -1 || echo 'no sonax-reg line')")
  fi

  # --- Check 4: transport-ws active
  TRANSPORTS=$(docker exec "$ASTERISK_CONTAINER" asterisk -rx "pjsip show transports" 2>&1)
  if ! echo "$TRANSPORTS" | grep -qE 'transport-ws.*ws'; then
    errors+=("TRANSPORT_WS_DOWN: transport-ws not active")
  fi

  # --- Check 5: endpoint count
  ENDPOINT_COUNT=$(docker exec "$ASTERISK_CONTAINER" asterisk -rx "pjsip show endpoints" 2>&1 | grep -c '^ Endpoint:' || echo "0")
  if [ "$ENDPOINT_COUNT" -lt 15 ]; then
    errors+=("LOW_ENDPOINT_COUNT: $ENDPOINT_COUNT < 15 (expected 15 ramais + sonax-trunk = 16)")
  fi
fi

# Decide: report status
if [ ${#errors[@]} -eq 0 ]; then
  # Healthy. Only log every hour to avoid spam.
  MINUTE=$(date +%M)
  if [ "$MINUTE" = "00" ]; then
    log "OK all checks pass (health=$HEALTH, sonax registered, transport-ws up, endpoints=${ENDPOINT_COUNT:-?})"
  fi
  # Clear alert state if was previously alerting
  if [ -f "$ALERT_STATE" ]; then
    log "RECOVERED from previous alert state"
    rm -f "$ALERT_STATE"
  fi
  exit 0
fi

# UNHEALTHY: log and possibly alert
ERROR_MSG=$(printf '%s\n' "${errors[@]}")
log "FAIL: $(echo "$ERROR_MSG" | tr '\n' ';')"

# Avoid alert spam: only send Telegram alert once per state-change OR every 1h while persisting
ALERT_HASH=$(echo "$ERROR_MSG" | sha256sum | awk '{print $1}')
LAST_HASH=$(cat "$ALERT_STATE" 2>/dev/null | head -1 || echo "none")
LAST_TIME=$(cat "$ALERT_STATE" 2>/dev/null | sed -n '2p' || echo "0")
NOW=$(date +%s)
SHOULD_ALERT=false

if [ "$ALERT_HASH" != "$LAST_HASH" ]; then
  SHOULD_ALERT=true
  log "ALERT REASON: state changed"
elif [ $((NOW - LAST_TIME)) -gt 3600 ]; then
  SHOULD_ALERT=true
  log "ALERT REASON: hourly re-alert (still failing)"
fi

if [ "$SHOULD_ALERT" = "true" ]; then
  echo "$ALERT_HASH" > "$ALERT_STATE"
  echo "$NOW" >> "$ALERT_STATE"

  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    MSG="🚨 *PontualPABX ALERT*%0A\`\`\`%0A${ERROR_MSG}%0A\`\`\`%0AHost: \`$(hostname)\`%0AChecked: \`$(date -Iseconds)\`"
    curl -sS --max-time 10 -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d "chat_id=${TELEGRAM_CHAT_ID}" \
      -d "parse_mode=Markdown" \
      -d "text=${MSG}" >/dev/null 2>&1 && log "TELEGRAM_SENT" || log "TELEGRAM_FAILED"
  else
    log "TELEGRAM_NOT_CONFIGURED (set /etc/asterisk-monitor.env with TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to enable)"
  fi
fi

exit 1
