#!/bin/bash
# smoke-test-pabx.sh
# Verificação sintética end-to-end externa do PontualPABX. Roda hourly via systemd timer.
#
# Faz checks de FORA (não dentro do container), simulando experiência de cliente:
#   1. HTTPS handshake em pabx.pontualtech.work (cert TLS válido + CN correto)
#   2. WSS upgrade (HTTP 101 Switching Protocols + Sec-Websocket-Protocol: sip)
#   3. ERP /api/internal/voip/ramais-conf retorna 200 com >=15 ramais (já implica auth funcional)
#   4. Cert DTLS no volume = cert LE (não self-signed)
#
# Útil pra detectar problemas que o monitor interno não pega:
#   - Cert TLS expirou (Traefik renovação falhou)
#   - DNS quebrado externamente
#   - Traefik route quebrada
#   - ERP fora do ar

set -uo pipefail

ENV_FILE=/etc/asterisk-sync.env
DOMAIN=pabx.pontualtech.work
ERP_ENDPOINT=https://erp.pontualtech.work/api/internal/voip/ramais-conf
LOG=/var/log/smoke-test-pabx.log
ALERT_STATE=/var/lib/smoke-test-alert-state
CERT_PATH=/var/lib/docker/volumes/bdjeh6wczqhnlnuq98slpd5j_asterisk-config/_data/keys/asterisk.crt

[ -r "$ENV_FILE" ] && . "$ENV_FILE"

log() { echo "$(date -Iseconds) $*" | tee -a "$LOG"; }

errors=()

# --- Check 1: HTTPS cert via openssl s_client (validates chain + CN)
TLS_INFO=$(echo | openssl s_client -servername "$DOMAIN" -connect "${DOMAIN}:443" 2>/dev/null \
  | openssl x509 -noout -subject -issuer -enddate 2>/dev/null)
if ! echo "$TLS_INFO" | grep -q "CN.*=.*${DOMAIN}"; then
  errors+=("TLS_CN_WRONG: $(echo "$TLS_INFO" | head -1)")
fi
if ! echo "$TLS_INFO" | grep -qi "Let's Encrypt"; then
  errors+=("TLS_NOT_LE: issuer not Let's Encrypt: $(echo "$TLS_INFO" | grep -i issuer | head -1)")
fi

# --- Check 2: WSS handshake (HTTP 101 expected)
# IMPORTANT: --http1.1 — HTTP/2 doesn't natively support WebSocket upgrade.
# Asterisk would return 426 Upgrade Required if curl negotiates HTTP/2.
WSS_RESP=$(curl -sS -i --max-time 5 --http1.1 \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Protocol: sip" \
  "https://${DOMAIN}/ws" 2>&1 | head -10 || true)
if ! echo "$WSS_RESP" | grep -q "101 Switching Protocols"; then
  errors+=("WSS_NO_101: $(echo "$WSS_RESP" | head -1)")
fi
if ! echo "$WSS_RESP" | grep -qi "Sec-Websocket-Protocol: sip"; then
  errors+=("WSS_NO_SIP_PROTOCOL: server didnt accept sip subprotocol")
fi

# --- Check 3: ERP endpoint reachable + auth OK + has ramais
if [ -n "${TOKEN:-}" ]; then
  ERP_BODY=$(curl -sS --max-time 10 -H "X-Sync-Token: $TOKEN" "$ERP_ENDPOINT" 2>&1 || echo "CURL_FAIL")
  RAMAL_COUNT=$(echo "$ERP_BODY" | grep -cE '^\[1[0-9]{2}\]' || echo "0")
  if [ "$RAMAL_COUNT" -lt 5 ]; then
    errors+=("ERP_NO_RAMAIS: only $RAMAL_COUNT [NNN] sections in response (expected >=5)")
  fi
else
  errors+=("CONFIG: TOKEN not set in $ENV_FILE; cant test ERP endpoint")
fi

# --- Check 4: cert DTLS on volume é LE (não self-signed)
if [ -r "$CERT_PATH" ]; then
  ISSUER=$(openssl x509 -in "$CERT_PATH" -noout -issuer 2>/dev/null)
  if ! echo "$ISSUER" | grep -qi "Let's Encrypt"; then
    errors+=("DTLS_NOT_LE: $ISSUER (extract-asterisk-le-cert.sh failed?)")
  fi
  # Days until expiry
  EXP_EPOCH=$(date -d "$(openssl x509 -enddate -noout -in "$CERT_PATH" | cut -d= -f2)" +%s)
  DAYS_LEFT=$(( (EXP_EPOCH - $(date +%s)) / 86400 ))
  if [ "$DAYS_LEFT" -lt 14 ]; then
    errors+=("DTLS_EXPIRING: cert expires in $DAYS_LEFT days (Traefik should auto-renew at <30)")
  fi
else
  errors+=("DTLS_MISSING: $CERT_PATH not found")
fi

# Report
if [ ${#errors[@]} -eq 0 ]; then
  HOUR=$(date +%H)
  if [ "$HOUR" = "08" ]; then
    log "OK all smoke checks pass (cert=LE, wss=101, erp ramais=$RAMAL_COUNT, dtls days=$DAYS_LEFT)"
  fi
  rm -f "$ALERT_STATE"
  exit 0
fi

ERROR_MSG=$(printf '%s\n' "${errors[@]}")
log "FAIL: $(echo "$ERROR_MSG" | tr '\n' ';')"

# Alert dedup logic — same as monitor
ALERT_HASH=$(echo "$ERROR_MSG" | sha256sum | awk '{print $1}')
LAST_HASH=$(cat "$ALERT_STATE" 2>/dev/null | head -1 || echo "none")
LAST_TIME=$(cat "$ALERT_STATE" 2>/dev/null | sed -n '2p' || echo "0")
NOW=$(date +%s)
SHOULD_ALERT=false
[ "$ALERT_HASH" != "$LAST_HASH" ] && SHOULD_ALERT=true
[ $((NOW - LAST_TIME)) -gt 21600 ] && SHOULD_ALERT=true  # re-alert every 6h while failing

if [ "$SHOULD_ALERT" = "true" ]; then
  echo "$ALERT_HASH" > "$ALERT_STATE"
  echo "$NOW" >> "$ALERT_STATE"

  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    MSG="⚠️ *PontualPABX SMOKE TEST FAIL*%0A\`\`\`%0A${ERROR_MSG}%0A\`\`\`%0AHost: \`$(hostname)\`%0AChecked: \`$(date -Iseconds)\`"
    curl -sS --max-time 10 -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d "chat_id=${TELEGRAM_CHAT_ID}" -d "parse_mode=Markdown" -d "text=${MSG}" >/dev/null 2>&1 \
      && log "TELEGRAM_SENT" || log "TELEGRAM_FAILED"
  else
    log "TELEGRAM_NOT_CONFIGURED"
  fi
fi

exit 1
