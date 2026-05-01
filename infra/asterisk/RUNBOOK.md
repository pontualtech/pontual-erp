# PontualPABX — Runbook

PABX próprio (Asterisk) que roda em paralelo ao Sonax. Funcionários conectam o webphone embedded no ERP via SIP-over-WebSocket + DTLS-SRTP.

> **Status atual** (2026-05-01): hardened com auto-cert LE, auto-sync ramais, monitoring + smoke tests. Sonax mantido como fallback de telefonia em produção.

## Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (Daniela, ramal 102)                               │
│   └─ <PontualWebphone /> (SIP.js)                           │
│       └─ wss://pabx.pontualtech.work/ws (TLS+SIP)           │
└─────────────────────────────────────────────────────────────┘
                       │
                       ▼ Traefik (Coolify proxy, LE cert)
                       │
                       ▼ http://172.17.0.1:8088/ws
┌─────────────────────────────────────────────────────────────┐
│  Servidor Imprimitech (37.27.195.163)                       │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Container asterisk-bdjeh6wczqhnlnuq98slpd5j           │ │
│  │  - Asterisk 20.x + chan_pjsip                          │ │
│  │  - transport-ws bind 0.0.0.0                           │ │
│  │  - 15 endpoints WebRTC (101-115) + sonax-trunk         │ │
│  │  - DTLS cert from Let's Encrypt (auto-renewed)         │ │
│  │  - Volume: bdjeh6wczqhnlnuq98slpd5j_asterisk-config    │ │
│  │     /etc/asterisk/pjsip.conf (manual base + #include)  │ │
│  │     /etc/asterisk/ramais.conf (auto-synced from DB)    │ │
│  │     /etc/asterisk/keys/asterisk.{crt,key} (LE)         │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  Host systemd timers:                                        │
│   - extract-asterisk-le-cert.timer (daily 04:00)             │
│   - sync-pjsip.timer (every 60s)                             │
│   - monitor-asterisk.timer (every 5min)                      │
│   - smoke-test-pabx.timer (every 1h)                         │
└─────────────────────────────────────────────────────────────┘
                       │
                       ▼ ipbx.sonax.net.br:5080 (SIP UDP trunk)
┌─────────────────────────────────────────────────────────────┐
│  Sonax PABX externo (PSTN gateway)                          │
└─────────────────────────────────────────────────────────────┘
```

## Componentes

### Backend Asterisk (Servidor Imprimitech)
- Container `asterisk-bdjeh6wczqhnlnuq98slpd5j` (Coolify-managed)
- Image: `andrius/asterisk:20-cert`
- Network mode: `host` (acesso direto à porta 8088 + transport-ws)
- Persistência: 4 named volumes Docker (config, lib, logs, recordings)

### Renderer (PontualERP)
- `apps/web/src/lib/voip/asterisk-templates/ramais.conf.tmpl` — template Mustache
- `apps/web/src/app/api/internal/voip/ramais-conf/route.ts` — endpoint GET text/plain
- Auth: `X-Sync-Token` header == `PJSIP_SYNC_TOKEN` env (constant-time compare)
- Tenant: hardcoded `pontualtech-001` (single-tenant Asterisk)

### Sync polling (host scripts)
- `/usr/local/bin/sync-pjsip.sh` — pull do endpoint, SHA compare, write + reload
- Roda a cada 60s via `sync-pjsip.timer`
- Self-healing: qualquer drift corrigido em <60s
- Fail-safe: response sem `[NNN]` sections é rejeitado (proteção contra build quebrado)

### Cert renewal
- `/usr/local/bin/extract-asterisk-le-cert.sh` — extrai cert LE de `/data/coolify/proxy/acme.json` via jq
- Roda diariamente via `extract-asterisk-le-cert.timer` (04:00 + 0-15min random)
- Idempotente (SHA compare antes de escrever + reload)
- Traefik cuida de renovação LE (HTTP-01) automaticamente

### Monitoring
- `/usr/local/bin/monitor-asterisk.sh` — 5 checks: container up, healthcheck, sonax registered, transport-ws active, endpoint count
- Roda a cada 5min via `monitor-asterisk.timer`
- Alertas Telegram (opcional, se `/etc/asterisk-monitor.env` tem `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`)
- Dedup: alerta só uma vez por state-change OU 1x/h enquanto persiste

### Smoke tests externos
- `/usr/local/bin/smoke-test-pabx.sh` — 4 checks de fora: TLS cert via openssl, WSS handshake, ERP endpoint reachable, DTLS cert é LE
- Roda hourly via `smoke-test-pabx.timer`
- Alerta Telegram se falhar (mesmo padrão do monitor)

## Setup inicial (one-time, em hosts novos)

```bash
# 1. Clone do repo no host
git clone https://github.com/pontualtech/pontual-erp.git /root/pontual-erp
cd /root/pontual-erp

# 2. Cria env files (PJSIP_SYNC_TOKEN deve bater com o env var no Coolify ERP)
echo 'TOKEN=<get-from-coolify-env>' > /etc/asterisk-sync.env
chmod 600 /etc/asterisk-sync.env

# 3. (Opcional) Telegram alerts
cat > /etc/asterisk-monitor.env <<EOF
TELEGRAM_BOT_TOKEN=<bot-token>
TELEGRAM_CHAT_ID=<chat-id>
EOF
chmod 600 /etc/asterisk-monitor.env

# 4. Install all scripts + systemd units + enable timers
bash infra/asterisk/install.sh
```

Pra atualizar (após `git pull`): roda `bash infra/asterisk/install.sh` de novo. Idempotente.

## Operação dia-a-dia

### Adicionar/editar/remover ramal
1. Admin entra em `/voip/admin/ramais` no ERP
2. Faz CRUD do ramal (set `is_active`, `description`, etc.)
3. ⏱ Espera ≤60s — `sync-pjsip.timer` puxa novo config + reload
4. ✅ Verifica em `pjsip show endpoints` (via Coolify Terminal → Asterisk container)

Sem necessidade de SSH ou docker exec manual.

### Verificar saúde geral
```bash
# Tudo OK?
systemctl status sync-pjsip.timer monitor-asterisk.timer smoke-test-pabx.timer extract-asterisk-le-cert.timer

# Logs
tail -50 /var/log/sync-pjsip.log
tail -50 /var/log/monitor-asterisk.log
tail -50 /var/log/smoke-test-pabx.log
tail -50 /var/log/extract-asterisk-le-cert.log

# Estado Asterisk
docker exec asterisk-bdjeh6wczqhnlnuq98slpd5j asterisk -rx "pjsip show endpoints"
docker exec asterisk-bdjeh6wczqhnlnuq98slpd5j asterisk -rx "pjsip show registrations"
```

### Trigger manual (debug)
```bash
/usr/local/bin/sync-pjsip.sh                # força sync agora
/usr/local/bin/extract-asterisk-le-cert.sh  # força extract cert
/usr/local/bin/monitor-asterisk.sh          # força healthcheck
/usr/local/bin/smoke-test-pabx.sh           # força smoke test
```

## Troubleshooting

### Webphone não aparece no ERP
- Check 1: env var `NEXT_PUBLIC_PONTUAL_WEBPHONE_ENABLED=true` no Coolify ERP. Sem isso, o componente não é renderizado.
- Check 2: build do ERP foi após setar a env? `NEXT_PUBLIC_*` é baked no build.

### Webphone aparece mas chamada cai sem áudio
- **Causa mais provável**: cert DTLS expirado/inválido. Check:
  ```bash
  openssl x509 -in /var/lib/docker/volumes/bdjeh6wczqhnlnuq98slpd5j_asterisk-config/_data/keys/asterisk.crt -noout -subject -issuer -enddate
  ```
- Issuer deve ser "Let's Encrypt R*". Se for self-signed ou expirado:
  ```bash
  /usr/local/bin/extract-asterisk-le-cert.sh
  ```
- Browser console (Chrome): `chrome://webrtc-internals` mostra ICE/DTLS state.

### Sonax outbound dropped
- Check 1: `pjsip show registrations` mostra `Registered (exp. >0s)` pra `sonax-reg`.
- Se `Unregistered` ou `Rejected`: credentials Sonax podem ter mudado. Edit `pjsip.conf` linha do `[sonax-auth]` block (manual — não auto-syncado).
- Check 2: IPs Sonax mudaram? Atualizar `[sonax-identify]` IPs em `pjsip.conf` manualmente.

### Sync falhou (HTTP error)
- HTTP 502/503 = ERP em deploy. Sync auto-recupera próximo minuto.
- HTTP 403 = `PJSIP_SYNC_TOKEN` divergente entre ERP env e `/etc/asterisk-sync.env`. Reset: gerar novo token, atualizar ambos lados.
- HTTP 200 mas resposta sem `[NNN]` = bug no renderer. Sync recusa escrever (proteção). Check ERP logs.

### Endpoint count caiu
- Se `monitor-asterisk.sh` reporta `LOW_ENDPOINT_COUNT`: ramais.conf pode ter perdido conteúdo.
- Restore manual:
  ```bash
  # Pega snapshot anterior do volume (se Coolify backups)
  cp /var/lib/docker/volumes/bdjeh6wczqhnlnuq98slpd5j_asterisk-config/_data/ramais.conf{.backup,}
  docker exec asterisk-bdjeh6wczqhnlnuq98slpd5j asterisk -rx "module reload res_pjsip"
  ```
- Próximo sync (60s) auto-corrige se DB estiver OK.

### Asterisk container down
- Coolify auto-restart configurado (restart: unless-stopped). Espera 30s.
- Check logs: `docker logs asterisk-bdjeh6wczqhnlnuq98slpd5j --tail 100`
- Manual restart via Coolify UI ou: `docker restart asterisk-bdjeh6wczqhnlnuq98slpd5j`

## Backup & restore

### Backup automático
- Volumes Docker são incluídos no backup geral do servidor (Coolify backup config)
- Logs em `/var/log/*.log` rotacionados via logrotate (não configurado ainda)

### Restore manual de pjsip.conf
- Backups históricos no volume:
  - `/etc/asterisk/pjsip.conf.bkp_pre_activation` (pré-ativação 2026-04-30)
  - `/etc/asterisk/pjsip.conf.before_include` (pré-migração #include 2026-05-01)
- Pra restaurar: `docker exec asterisk-... cp <bkp> /etc/asterisk/pjsip.conf && docker exec asterisk-... asterisk -rx "module reload res_pjsip"`

## Rollback completo (nuclear)

Se precisar reverter pra "Sonax-only" (esconder PontualPABX completamente):

```bash
# 1. Esconder UI (não disruptivo)
# Coolify ERP env: NEXT_PUBLIC_PONTUAL_WEBPHONE_ENABLED=false
# Trigger redeploy

# 2. (Opcional) Parar timers do hardening
systemctl stop sync-pjsip.timer monitor-asterisk.timer smoke-test-pabx.timer
systemctl disable sync-pjsip.timer monitor-asterisk.timer smoke-test-pabx.timer

# 3. (Não fazer a menos que necessário) Remover endpoints WebRTC
docker exec asterisk-bdjeh6wczqhnlnuq98slpd5j sh -c 'echo "" > /etc/asterisk/ramais.conf'
docker exec asterisk-bdjeh6wczqhnlnuq98slpd5j asterisk -rx "module reload res_pjsip"

# 4. Sonax trunk continua funcional (não é tocado)
```

## Variáveis de ambiente

| Var | Onde | Pra que |
|---|---|---|
| `PJSIP_SYNC_TOKEN` | Coolify ERP env (runtime, NÃO buildtime) | Auth do endpoint `/api/internal/voip/ramais-conf` |
| `NEXT_PUBLIC_PONTUAL_WEBPHONE_ENABLED` | Coolify ERP env (runtime + buildtime) | Mostra/esconde o `<PontualWebphone />` |
| `PONTUAL_PABX_WS_URL` | Coolify ERP env (runtime, opcional) | Override do default `wss://pabx.pontualtech.work/ws` |
| `PONTUAL_PABX_DOMAIN` | Coolify ERP env (runtime, opcional) | Override do SIP domain default |
| `TOKEN` | `/etc/asterisk-sync.env` (host) | Cliente do `PJSIP_SYNC_TOKEN` (deve bater) |
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | `/etc/asterisk-monitor.env` (host, opcional) | Alertas |

## Decisões arquiteturais (ADRs)

### ADR-001: Reconciliation polling > webhook push
Decisão de usar `sync-pjsip.timer` (puxa) ao invés de webhook (empurra) do ERP pro Asterisk. Razões:
- Self-healing: drift corrigido em ≤60s independente de causa (manual edit, container recreate, timeout)
- Sem novo container, sem novo port, sem HMAC
- Stateless: ERP não precisa saber se Asterisk recebeu

Trade-off: até 60s delay entre CRUD e sync. Aceitável pra ops PABX.

### ADR-002: pjsip.conf manual + ramais.conf auto via #include
Pra evitar que renderer precise gerenciar a complexidade do Sonax block (3 IPs identify, registration, custom contact_user, password). Templates e Sonax ficam manuais (raramente mudam). Ramais ficam dinâmicos via `#include`.

### ADR-003: Self-signed inicial → LE auto-extract
Ativação inicial usou self-signed (10y, zero infra). Hardening trocou pra LE com cert renewal automático via Traefik+systemd timer. Cert WebRTC pra browser não precisa CA chain (DTLS usa fingerprint), mas LE dá consistência operacional + cert válido pra eventual SIP federation.

### ADR-004: Pre-load all 15 ramais (não só is_active)
Endpoint `/api/internal/voip/ramais-conf` retorna todos os 15 ramais WebRTC, mesmo `is_active=false`. Permite admin ativar um ramal só mudando o flag no DB sem precisar de reload PJSIP — o endpoint já existe, só falta o REGISTER do browser. Endpoints sem REGISTER ficam `Unavailable` (inofensivo).

### ADR-005: Endpoint em /api/internal/* (não /api/voip/admin/*)
Pra pular o auth-cookie middleware (`src/middleware.ts:87-89`). Sync polling não tem session. Auth aqui é via `X-Sync-Token` constant-time compare.

## Tags git relevantes

| Tag | Significado |
|---|---|
| `deploy-2026-04-30-pontualpabx-paused` | Estado quando F4 estava pausado (Sonax único ativo) |
| `pre-pontualpabx-activation-2026-04-30-1756` | Imediatamente antes da ativação F4 |
| `deploy-2026-05-01-pontualpabx-hardened` | Após hardening (este runbook em vigor) |
