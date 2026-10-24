#!/usr/bin/env bash
# Run on the Linux proxy VM from a checkout of this repository.
set +x
set -euo pipefail
PROXY_HOST="${1:?Usage: sudo bash deploy-extension-proxy.sh <public-dns-host> <fullchain.pem> <privkey.pem> [port]}"
PROXY_CERT="${2:?Certificate path required}"
PROXY_KEY="${3:?Certificate private key path required}"
PROXY_PORT="${4:-8443}"
[[ "$EUID" == 0 ]] || { echo 'Run as root to install private runtime files.' >&2; exit 1; }
[[ "$PROXY_HOST" =~ ^[A-Za-z0-9.-]+$ && "$PROXY_HOST" == *.* && "$PROXY_PORT" =~ ^[0-9]+$ ]] || exit 1
((PROXY_PORT>=1024 && PROXY_PORT<=65535)) || exit 1
command -v docker >/dev/null
openssl x509 -in "$PROXY_CERT" -noout -checkend 86400
openssl x509 -in "$PROXY_CERT" -noout -checkhost "$PROXY_HOST"
[[ "$(openssl x509 -in "$PROXY_CERT" -pubkey -noout | openssl sha256)" == "$(openssl pkey -in "$PROXY_KEY" -pubout | openssl sha256)" ]] || { echo 'Certificate and private key do not match.' >&2; exit 1; }
read -r -s -p 'Paste the 64-hex EXTENSION_GATEWAY_SECRET stored for Cloud Run (input hidden): ' PROXY_GATEWAY_VALUE
printf '\n'
[[ "$PROXY_GATEWAY_VALUE" =~ ^[a-fA-F0-9]{64}$ ]] || { unset PROXY_GATEWAY_VALUE;exit 1; }
trap 'unset PROXY_GATEWAY_VALUE' EXIT
umask 077
install -d -m 750 -o root -g 1000 /etc/xhuvpn-extension/certs
install -m 640 -o root -g 1000 "$PROXY_CERT" /etc/xhuvpn-extension/certs/fullchain.pem
install -m 640 -o root -g 1000 "$PROXY_KEY" /etc/xhuvpn-extension/certs/privkey.pem
{
  printf 'EXTENSION_GATEWAY_SECRET=%s\n' "$PROXY_GATEWAY_VALUE"
  printf 'PORTAL_ORIGIN=https://vpn.skoonline.org\nPROXY_PUBLIC_HOST=%s\nPORT=8443\n' "$PROXY_HOST"
} > /etc/xhuvpn-extension/runtime.env
unset PROXY_GATEWAY_VALUE
cd "$(dirname "$0")"
docker build -f proxy/Dockerfile -t xhuvpn-extension-proxy:local .
if docker container inspect xhuvpn-extension-proxy >/dev/null 2>&1; then docker stop xhuvpn-extension-proxy;docker rm xhuvpn-extension-proxy;fi
docker run -d --name xhuvpn-extension-proxy --restart unless-stopped \
  --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 128 --memory 256m --cpus 1 \
  --env-file /etc/xhuvpn-extension/runtime.env --mount type=bind,src=/etc/xhuvpn-extension/certs,dst=/certs,readonly \
  -p "$PROXY_PORT:8443" xhuvpn-extension-proxy:local
printf 'Proxy installed. Point %s at this VM and allow TCP %s in its firewall. Keep certificate renewal current.\n' "$PROXY_HOST" "$PROXY_PORT"
