#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="${DATA_DIR:-/data}"
AXL_DIR="${AXL_DIR:-$DATA_DIR/axl}"
HAXY_DATA_DIR="${HAXY_DATA_DIR:-$DATA_DIR/haxy}"
AXL_API_HOST="${AXL_API_HOST:-127.0.0.1}"
AXL_API_PORT="${AXL_API_PORT:-9002}"
AXL_TCP_PORT="${AXL_TCP_PORT:-7000}"
HAXY_LISTEN="${HAXY_LISTEN:-127.0.0.1:8080}"
BRIDGE_LISTEN="${BRIDGE_LISTEN:-0.0.0.0:8090}"
HAXY_ENDPOINT="${HAXY_ENDPOINT:-127.0.0.1:8080}"
AXL_ENDPOINT="${AXL_ENDPOINT:-127.0.0.1:9002}"
SEPOLIA_RPC_URL="${SEPOLIA_RPC_URL:-https://ethereum-sepolia-rpc.publicnode.com}"
DGIT_PUBLIC_ENDPOINT="${DGIT_PUBLIC_ENDPOINT:-127.0.0.1:8090}"
DGIT_REGISTRAR_ADDRESS="${DGIT_REGISTRAR_ADDRESS:-0xEC246e46af036FD12bdA86F96aCce83fF9c62788}"
CAST_BIN="${CAST_BIN:-/usr/local/bin/cast}"

mkdir -p "$AXL_DIR" "$HAXY_DATA_DIR"

if [[ ! -f "$AXL_DIR/private.pem" ]]; then
  echo "[entrypoint] generating AXL ed25519 private key at $AXL_DIR/private.pem"
  openssl genpkey -algorithm ed25519 -out "$AXL_DIR/private.pem"
fi

cat > "$AXL_DIR/node-config.json" <<EOF
{
  "PrivateKeyPath": "$AXL_DIR/private.pem",
  "Peers": [
    "tls://34.46.48.224:9001",
    "tls://136.111.135.206:9001"
  ],
  "Listen": [],
  "bridge_addr": "$AXL_API_HOST",
  "api_port": $AXL_API_PORT,
  "tcp_port": $AXL_TCP_PORT
}
EOF

export HAXY_ENDPOINT AXL_ENDPOINT SEPOLIA_RPC_URL DGIT_PUBLIC_ENDPOINT DGIT_REGISTRAR_ADDRESS CAST_BIN
export PRIVATE_KEY="${PRIVATE_KEY:-}"

if [[ -z "$PRIVATE_KEY" ]]; then
  echo "[entrypoint] PRIVATE_KEY is not set; pulls and local --no-claim style use can work, but new ENS claims will fail"
fi

children=()
shutdown() {
  echo "[entrypoint] shutting down"
  for pid in "${children[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap shutdown INT TERM EXIT

echo "[entrypoint] starting AXL node on $AXL_API_HOST:$AXL_API_PORT"
axl-node -config "$AXL_DIR/node-config.json" &
children+=("$!")

echo "[entrypoint] waiting for AXL topology"
for _ in $(seq 1 60); do
  if curl -fsS "http://$AXL_ENDPOINT/topology" >/tmp/dgit-axl-topology.json 2>/dev/null; then
    echo "[entrypoint] AXL public key: $(python3 -c 'import json; print(json.load(open("/tmp/dgit-axl-topology.json"))["our_public_key"])')"
    break
  fi
  sleep 1
done

echo "[entrypoint] starting Haxy on $HAXY_LISTEN"
haxy serve --http-listen "$HAXY_LISTEN" --data-dir "$HAXY_DATA_DIR" &
children+=("$!")

echo "[entrypoint] starting dgit bridge on $BRIDGE_LISTEN"
dgit_axl_bridge.py \
  --listen "$BRIDGE_LISTEN" \
  --haxy "http://$HAXY_ENDPOINT" \
  --axl "http://$AXL_ENDPOINT" \
  --public-endpoint "$DGIT_PUBLIC_ENDPOINT" \
  --cast-bin "$CAST_BIN" &
children+=("$!")

wait -n "${children[@]}"
