# Migração PontualPABX — Habilitar SIP-WS + WebRTC no Asterisk

Documento dos passos manuais que precisam ser executados em servidor + DNS pra
que o webphone próprio (SIP.js no browser) funcione. Os templates `*.tmpl`
já estão atualizados — falta só o lado de operação.

## Visão geral

```
Browser (SIP.js) -- wss://pabx.pontualtech.work/ws --> Caddy (TLS termination)
                                                            |
                                                            v
                                                     ws://127.0.0.1:8088/ws
                                                            |
                                                            v
                                                     Asterisk (host network)
                                                     [transport-ws]
                                                            |
                                                  DTLS-SRTP audio (UDP RTP 10000-20000)
                                                            |
                                                            v
                                                       Browser RTCPeerConnection
```

## Pré-requisitos

- Asterisk 20+ (já temos `andrius/asterisk:20-cert`).
- Cert SSL pra `pabx.pontualtech.work` (Let's Encrypt).
- Coolify rodando, com Caddy/Traefik proxy embutido.

## Passos

### 1. DNS

No provedor (Hostinger), criar:

```
Tipo: A
Host: pabx
Aponta pra: 37.27.42.114   (IP da VPS Hetzner)
TTL: 600
```

Validar com `dig pabx.pontualtech.work +short`.

### 2. Cert SSL via Let's Encrypt

Como o Asterisk roda em `network_mode: host`, ele compartilha as portas com a VPS.
Não dá pra rodar Coolify-managed cert direto pro Asterisk — vamos gerar **manual**
e bind no volume.

```bash
# Na VPS Hetzner via SSH:
ssh root@37.27.42.114

# Para o Caddy temporariamente pra liberar porta 80
# (depende de qual proxy o Coolify usa — verificar)
docker stop coolify-proxy   # ou coolify-traefik

# Gera cert standalone
docker run --rm \
  -p 80:80 \
  -v asterisk-tls:/etc/letsencrypt \
  certbot/certbot certonly --standalone \
  -d pabx.pontualtech.work \
  --email karlao@pontualtech.com.br \
  --agree-tos --non-interactive

# Volta o Caddy
docker start coolify-proxy

# Copia cert pra volume do Asterisk
docker run --rm \
  -v asterisk-tls:/src \
  -v pontualtech-asterisk-config:/dst \
  alpine sh -c '
    mkdir -p /dst/keys
    cp /src/live/pabx.pontualtech.work/fullchain.pem /dst/keys/asterisk.crt
    cp /src/live/pabx.pontualtech.work/privkey.pem  /dst/keys/asterisk.key
    chmod 644 /dst/keys/asterisk.crt
    chmod 600 /dst/keys/asterisk.key
  '
```

### 3. Caddy proxy pra SIP-WS

No Coolify, adicionar route pro Caddy:

```caddy
pabx.pontualtech.work {
    reverse_proxy /ws ws://127.0.0.1:8088
    # 8088 = HTTP do Asterisk (network_mode: host)
}
```

Ou via Coolify Service > Custom Caddy Config (depende da versão do Coolify).
Alternativa via API: dar push de label `caddy.reverse_proxy.pabx → 8088`.

### 4. Regenerar config Asterisk com novos templates

Após deploy do código com `pjsip.conf.tmpl` atualizado, chamar a API:

```bash
# Endpoint a ser portado do pontual-erp/ pro erp-clone-ui/
# Por enquanto, manualmente:

docker exec pontualtech-asterisk asterisk -rx "module reload res_pjsip.so"
docker exec pontualtech-asterisk asterisk -rx "http show status"
docker exec pontualtech-asterisk asterisk -rx "pjsip show transports"
```

Esperado:
- `http show status` mostra HTTP server bound em 127.0.0.1:8088 com `WebSocket: enabled`.
- `pjsip show transports` lista `transport-udp` e `transport-ws`.

### 5. Renovação automática do cert (90 dias)

Adicionar cron na VPS:

```bash
# /etc/cron.d/asterisk-cert-renew
0 4 1 */2 * root docker run --rm -p 80:80 -v asterisk-tls:/etc/letsencrypt certbot/certbot renew && docker run --rm -v asterisk-tls:/src -v pontualtech-asterisk-config:/dst alpine sh -c 'cp /src/live/pabx.pontualtech.work/fullchain.pem /dst/keys/asterisk.crt && cp /src/live/pabx.pontualtech.work/privkey.pem /dst/keys/asterisk.key' && docker exec pontualtech-asterisk asterisk -rx "module reload res_pjsip.so"
```

### 6. Validação manual

Browser DevTools console:

```js
// Não confunde porta:443 implícito em wss://
const ws = new WebSocket('wss://pabx.pontualtech.work/ws', 'sip');
ws.onopen = () => console.log('WSS OPEN ✓');
ws.onerror = (e) => console.error('WSS FAIL', e);
ws.onclose = (e) => console.log('WSS CLOSED', e.code, e.reason);
```

Esperado: `WSS OPEN ✓`. Se erro 502/504 → Caddy proxy mal configurado.
Se ECONNREFUSED → Asterisk HTTP server não subiu (verificar `http show status`).

### 7. Próximos passos (Fase 2)

Após F1 OK:
- Adicionar campo `webrtc: boolean` na tabela `voip_extensions`
- Marcar ramais 101-105 como `webrtc=true`
- Criar página `/super-admin/voip/ramais` pra criar 106-115
- Implementar `<PontualWebphone />` com SIP.js

## Rollback

Tudo pode ser desfeito em segundos:

1. Reverter templates pra commit anterior.
2. `docker exec pontualtech-asterisk asterisk -rx "core restart now"` — volta ao estado UDP-only.
3. Webphone Sonax continua funcionando paralelo (não foi tocado).
