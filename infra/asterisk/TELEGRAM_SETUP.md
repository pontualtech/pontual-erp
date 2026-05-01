# Telegram Alerts Setup

Pra ativar alertas no Telegram quando `monitor-asterisk.sh` ou `smoke-test-pabx.sh` detectarem falha.

## Pré-requisitos

1. **Bot Telegram criado**:
   - Abre conversa com [@BotFather](https://t.me/BotFather)
   - `/newbot` → escolhe nome e username
   - Salva o token (formato `123456789:ABCdef...`)

2. **Chat ID descoberto**:
   - Inicia conversa com seu bot novo (manda qualquer msg)
   - Visita `https://api.telegram.org/bot<TOKEN>/getUpdates`
   - Procura `"chat":{"id":NNN}` — esse `NNN` é o chat ID
   - Se for grupo, ID começa com `-` (ex: `-123456789`)

## Setup no host

No servidor Imprimitech (37.27.195.163):

```bash
sudo bash -c 'cat > /etc/asterisk-monitor.env <<EOF
TELEGRAM_BOT_TOKEN=123456789:ABCdef...
TELEGRAM_CHAT_ID=987654321
EOF
chmod 600 /etc/asterisk-monitor.env'
```

## Validar

Roda smoke test (que já falha por algum motivo de teste):

```bash
# Trigger smoke test agora
systemctl start smoke-test-pabx.service

# Ver log
tail /var/log/smoke-test-pabx.log

# Se tudo OK, vai ter linha "TELEGRAM_SENT" no log
```

Forçar uma falha pra testar alerta:

```bash
# Para o Asterisk container brevemente — monitor vai detectar
docker stop asterisk-bdjeh6wczqhnlnuq98slpd5j
sleep 30
systemctl start monitor-asterisk.service
# Ver alerta no Telegram
docker start asterisk-bdjeh6wczqhnlnuq98slpd5j
```

## Mensagem-tipo

```
🚨 PontualPABX ALERT
```
SONAX_NOT_REGISTERED: sonax-reg/sip:200.201.212.68:5080  Unregistered
LOW_ENDPOINT_COUNT: 6 < 15 (expected 15 ramais + sonax-trunk = 16)
```
Host: `Imprimitech`
Checked: `2026-05-01T12:34:56+00:00`
```

## Anti-spam

Ambos scripts (monitor + smoke) implementam dedup:
- **Monitor**: alerta 1x por state-change OR 1h re-alert se persistente
- **Smoke**: alerta 1x por state-change OR 6h re-alert

State é guardado em `/var/lib/{monitor,smoke-test}-asterisk-alert-state` — apagado quando recupera.

## Trocar tokens

Edita `/etc/asterisk-monitor.env`. Sem necessidade de restart de timer — scripts re-leem env file a cada execução.
