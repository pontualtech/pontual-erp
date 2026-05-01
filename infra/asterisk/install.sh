#!/bin/bash
# install.sh — Install/update all PontualPABX hardening infra on the Imprimitech host.
#
# Idempotent: safe to re-run after git pull (overwrites scripts + units, restarts timers).
# Run as root on Servidor Imprimitech (37.27.195.163).
#
# Usage (from cloned repo on host, e.g. /root/pontual-erp/):
#   bash infra/asterisk/install.sh
#
# Pre-reqs (one-time setup, NOT done by this script):
#   1. /etc/asterisk-sync.env — TOKEN=<value of PJSIP_SYNC_TOKEN env var on Coolify ERP>
#   2. /etc/asterisk-monitor.env (optional) — TELEGRAM_BOT_TOKEN=... and TELEGRAM_CHAT_ID=...

set -euo pipefail

REPO_DIR=$(cd "$(dirname "$0")/../.." && pwd)
SCRIPTS_SRC="$REPO_DIR/infra/asterisk/scripts"
SYSTEMD_SRC="$REPO_DIR/infra/asterisk/systemd"
SCRIPTS_DST=/usr/local/bin
SYSTEMD_DST=/etc/systemd/system

[ "$(id -u)" -eq 0 ] || { echo "FATAL: run as root"; exit 2; }
[ -d "$SCRIPTS_SRC" ] || { echo "FATAL: $SCRIPTS_SRC not found (wrong working dir?)"; exit 2; }

echo "[install] Copying scripts to $SCRIPTS_DST..."
for f in extract-asterisk-le-cert.sh sync-pjsip.sh monitor-asterisk.sh smoke-test-pabx.sh; do
  install -m 755 -o root -g root "$SCRIPTS_SRC/$f" "$SCRIPTS_DST/$f"
  echo "  + $SCRIPTS_DST/$f"
done

echo "[install] Copying systemd units to $SYSTEMD_DST..."
for f in extract-asterisk-le-cert.service extract-asterisk-le-cert.timer \
         sync-pjsip.service sync-pjsip.timer \
         monitor-asterisk.service monitor-asterisk.timer \
         smoke-test-pabx.service smoke-test-pabx.timer; do
  install -m 644 -o root -g root "$SYSTEMD_SRC/$f" "$SYSTEMD_DST/$f"
  echo "  + $SYSTEMD_DST/$f"
done

echo "[install] Reloading systemd daemon..."
systemctl daemon-reload

echo "[install] Enabling + starting timers..."
for t in extract-asterisk-le-cert.timer sync-pjsip.timer monitor-asterisk.timer smoke-test-pabx.timer; do
  systemctl enable --now "$t"
  echo "  + $t enabled+started"
done

echo "[install] Pre-flight checks..."
[ -r /etc/asterisk-sync.env ] || echo "  ⚠️  /etc/asterisk-sync.env missing — sync-pjsip.sh will fail. Create with: TOKEN=<PJSIP_SYNC_TOKEN value>"
[ -r /etc/asterisk-monitor.env ] || echo "  ℹ️  /etc/asterisk-monitor.env missing — Telegram alerts disabled (set TELEGRAM_BOT_TOKEN+TELEGRAM_CHAT_ID to enable)"

echo "[install] Status:"
systemctl list-timers extract-asterisk-le-cert.timer sync-pjsip.timer monitor-asterisk.timer smoke-test-pabx.timer --no-pager

echo "[install] DONE. Logs:"
echo "  /var/log/extract-asterisk-le-cert.log"
echo "  /var/log/sync-pjsip.log"
echo "  /var/log/monitor-asterisk.log"
echo "  /var/log/smoke-test-pabx.log"
echo "  Or via journalctl -u <unit-name>"
