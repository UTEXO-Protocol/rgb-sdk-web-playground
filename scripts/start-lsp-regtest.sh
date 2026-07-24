#!/usr/bin/env bash
# start-lsp-regtest.sh
#
# Local LSP/APay regtest stack for the *web* demo (rgb-sdk-web), set up from
# scratch. Companion to docs/LSP_REGTEST_SETUP.md.
#
# Unlike the React Native script, the browser wasm node cannot open raw TCP or
# shell out to bitcoin-cli, so this stack runs the **wasm-proxy-gateway** which
# bridges:
#   - LN P2P over WebSocket   ( ws://127.0.0.1:3001/ln/v1/<host>/<port> )
#   - RGB JSON-RPC transport  ( http://127.0.0.1:3001/rgb/json-rpc )
#   - regtest funding         ( POST /dev/regtest/fund )
#   - native RLN REST proxy   ( /dev/regular-rln/* → Faucet, for browser-driven sendrgb )
#
# Topology (all on the compose.wasm.yaml *esplora* regtest chain):
#   compose.wasm.yaml: bitcoind/electrs/proxy(:3000)/esplora(:3002, btc rpc :18444)
#   gateway   :3001  (cargo run -p wasm-proxy-gateway --features dev-http)
#   LSP RLN   :3105  peer :9745   (--lsp-base-url → utexo-lsp)
#   Faucet RLN:3108  peer :9748   (issues + seeds the asset)
#   utexo-lsp :8080
#
# Browser windows (Recipient + Sender) each create one UTEXOWallet and talk
# Lightning to the LSP through the gateway; the LSP routes between them.
#
# Requires two sibling repos, passed via env (NOT hardcoded — set these first):
#   export RGBLN_REPO=/absolute/path/to/rgb-lightning-node
#   export UTEXO_LSP_REPO=/absolute/path/to/utexo-lsp
#
# Usage:
#   ./scripts/start-lsp-regtest.sh          # bring everything up, write .env.local
#   VSS=1 ./scripts/start-lsp-regtest.sh    # …plus local vss-server :8081 (cloud
#                                           # backup; browser reaches it via the
#                                           # Vite /vss proxy — VITE_VSS_URL)
#   ./scripts/start-lsp-regtest.sh stop     # tear everything down (incl. VSS)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RGBLN_REPO="${RGBLN_REPO:?Set RGBLN_REPO to your rgb-lightning-node path, e.g.: export RGBLN_REPO=~/rgb/rgb-lightning-node}"
UTEXO_LSP_REPO="${UTEXO_LSP_REPO:?Set UTEXO_LSP_REPO to your utexo-lsp path, e.g.: export UTEXO_LSP_REPO=~/rgb/utexo-lsp}"
RLN_BIN="$RGBLN_REPO/target/release/rgb-lightning-node"
COMPOSE_FILE="$RGBLN_REPO/bindings/wasm-sdk/compose.wasm.yaml"
# Root compose has the vss-server (sigs-auth) + vss-postgres services behind the
# `vss` profile — chain-independent, so the wasm stack reuses them as-is.
# Opt in with VSS=1 (same convention as regtest.sh).
ROOT_COMPOSE="$RGBLN_REPO/compose.yaml"
LOGS="$RGBLN_REPO/logs"

# ── ports / endpoints ─────────────────────────────────────────────────────────
GATEWAY_PORT=3001
PROXY_PORT=3000
ESPLORA_PORT=3002          # esplora HTTP indexer (RLN nodes + wasm wallets use this)
ESPLORA_BTC_RPC=18444      # esplora-service bitcoind RPC (host-mapped)
LSP_PORT=3105;    LSP_PEER_PORT=9745
FAUCET_PORT=3108; FAUCET_PEER_PORT=9748
UTEXO_PORT=8080
VSS_PORT=8081              # vss-server (root compose, --profile vss; VSS=1 opt-in)
DEV_ORIGIN="http://localhost:5173"

PASSWORD="rln-password"
APAY_BEARER_TOKEN="devtoken"
INDEXER_URL="http://127.0.0.1:$ESPLORA_PORT"
PROXY_ENDPOINT="rpc://127.0.0.1:$PROXY_PORT/json-rpc"
UNLOCK_BODY="{\"password\":\"$PASSWORD\",\"indexer_url\":\"$INDEXER_URL\",\"proxy_endpoint\":\"$PROXY_ENDPOINT\",\"announce_addresses\":[]}"

# esplora-service bitcoind creds (see compose.wasm.yaml esplora command)
BTC_RPC_USER="admin"; BTC_RPC_PASS="passw"; BTC_WALLET="bdk-test"

ENV_LOCAL="$DEMO_DIR/.env.local"
GATEWAY_PIDFILE="$LOGS/web-gateway.pid"

log() { echo "[lsp-regtest] $*"; }
die() { echo "[lsp-regtest] ERROR: $*" >&2; exit 1; }

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

# bitcoin-cli inside the esplora container (the chain everyone shares)
btc() {
  compose exec -T esplora /root/bitcoin-cli -regtest \
    -rpcuser="$BTC_RPC_USER" -rpcpassword="$BTC_RPC_PASS" -rpcwallet="$BTC_WALLET" "$@"
}
btc_mine() { btc -generate "$1" >/dev/null && log "mined $1 block(s)"; }
btc_send() {
  local out
  out=$(btc sendtoaddress "$1" "$2") || die "sendtoaddress $1 $2 failed: $out"
  printf '%s' "$out" | tr -d '"'
}

# POST and surface the server's response body on failure (curl -f hides it).
rln_post() {
  local port=$1 path=$2 body=${3:-'{}'} resp code
  resp=$(curl -s -w $'\n%{http_code}' -X POST "http://127.0.0.1:$port$path" \
    -H 'content-type: application/json' -d "$body")
  code=${resp##*$'\n'}; resp=${resp%$'\n'*}
  { [ "$code" -ge 200 ] && [ "$code" -lt 400 ]; } 2>/dev/null \
    || die "POST $path on :$port → HTTP ${code:-?}: $resp"
  printf '%s' "$resp"
}
rln_get() { curl -sf "http://127.0.0.1:$1$2" || die "GET $2 failed on :$1"; }

wait_http() { # url label deadline_s
  local url=$1 label=$2 deadline=$((SECONDS + ${3:-60}))
  log "waiting for $label …"
  until curl -sf -o /dev/null "$url" 2>/dev/null; do
    [ $SECONDS -lt $deadline ] || die "$label not ready in time"
    sleep 2
  done
  log "$label ready"
}
wait_rln() { # port label  (200 ready, 403 locked — both mean listening)
  local port=$1 label=$2 deadline=$((SECONDS + 60)) code
  log "waiting for $label on :$port …"
  while true; do
    code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$port/nodeinfo" 2>/dev/null || echo 000)
    [ "$code" = 200 ] || [ "$code" = 403 ] && break
    [ $SECONDS -lt $deadline ] || die "$label did not start (last $code)"
    sleep 1
  done
  log "$label listening"
}
wait_rln_unlocked() {
  local port=$1 deadline=$((SECONDS + 90)) code
  while true; do
    code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$port/nodeinfo" 2>/dev/null || echo 000)
    [ "$code" = 200 ] && break
    [ $SECONDS -lt $deadline ] || die "node :$port did not unlock (last $code)"
    sleep 2
  done
}
# Poll /btcbalance until the node's vanilla wallet has synced the on-chain funding.
wait_btc() { # port label
  local port=$1 label=$2 deadline=$((SECONDS + 120)) fut
  log "waiting for $label to see on-chain funds …"
  while true; do
    fut=$(curl -s -X POST "http://127.0.0.1:$port/btcbalance" -H 'content-type: application/json' \
      -d '{"skip_sync":false}' 2>/dev/null | jq -r '.vanilla.future // .vanilla.spendable // 0' 2>/dev/null || echo 0)
    case "$fut" in (''|*[!0-9]*) fut=0;; esac
    [ "$fut" -gt 0 ] && { log "$label sees $fut sat (vanilla)"; return 0; }
    [ $SECONDS -lt $deadline ] || die "$label did not see funds within timeout"
    sleep 3
  done
}
# Refresh + poll /assetbalance until the node has >= min spendable units of asset.
wait_asset() { # port asset_id min label
  local port=$1 aid=$2 min=$3 label=$4 deadline=$((SECONDS + 120)) sp
  while true; do
    curl -s -X POST "http://127.0.0.1:$port/refreshtransfers" -H 'content-type: application/json' \
      -d '{"filter":[],"skip_sync":false}' >/dev/null 2>&1 || true
    sp=$(curl -s -X POST "http://127.0.0.1:$port/assetbalance" -H 'content-type: application/json' \
      -d "{\"asset_id\":\"$aid\"}" 2>/dev/null | jq -r '.spendable // 0' 2>/dev/null || echo 0)
    case "$sp" in (''|*[!0-9]*) sp=0;; esac
    [ "$sp" -ge "$min" ] && { log "$label asset spendable=$sp"; return 0; }
    [ $SECONDS -lt $deadline ] || die "$label asset did not settle (spendable=$sp, need $min)"
    sleep 3
  done
}
# Non-fatal "is the server listening" check — any HTTP response (incl. 404) counts.
# Used for services that don't return 2xx on GET / (e.g. rgb-proxy-server's JSON-RPC).
wait_listen() { # url label deadline_s
  local url=$1 label=$2 deadline=$((SECONDS + ${3:-60})) code
  log "waiting for $label …"
  while true; do
    code=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo 000)
    [ "$code" != 000 ] && { log "$label ready (HTTP $code)"; return 0; }
    [ $SECONDS -lt $deadline ] || { log "WARN: $label not confirmed — continuing"; return 0; }
    sleep 2
  done
}

# ── stop ──────────────────────────────────────────────────────────────────────
if [ "${1:-}" = stop ]; then
  log "stopping …"
  [ -f "$GATEWAY_PIDFILE" ] && kill "$(cat "$GATEWAY_PIDFILE")" 2>/dev/null || true
  rm -f "$GATEWAY_PIDFILE"
  pkill -f "wasm-proxy-gateway" 2>/dev/null || true
  pkill -f "rgb-lightning-node.*data_lsp_web"    2>/dev/null || true
  pkill -f "rgb-lightning-node.*data_faucet_web" 2>/dev/null || true
  pkill -f "go run \."  2>/dev/null || true
  pkill -f "utexo-lsp"  2>/dev/null || true
  compose down 2>/dev/null || true
  # VSS lives in the root compose project (profile `vss`); harmless if not up.
  docker compose -f "$ROOT_COMPOSE" --profile vss down 2>/dev/null || true
  log "done."
  exit 0
fi

# ── preflight ─────────────────────────────────────────────────────────────────
[ -f "$RLN_BIN" ] || die "RLN binary missing: $RLN_BIN  (cargo build --release --bin rgb-lightning-node)"
[ -f "$COMPOSE_FILE" ] || die "compose file missing: $COMPOSE_FILE"
[ -d "$UTEXO_LSP_REPO" ] || die "utexo-lsp repo missing: $UTEXO_LSP_REPO"
command -v go >/dev/null  || die "go not found"
command -v jq >/dev/null  || die "jq not found (brew install jq)"
command -v cargo >/dev/null || die "cargo not found"
mkdir -p "$LOGS"

# ── 1. compose infra (everything except the gateway service) ──────────────────
log "starting compose.wasm.yaml infra (bitcoind/electrs/proxy/esplora) …"
compose up -d bitcoind electrs proxy esplora
wait_http "http://127.0.0.1:$ESPLORA_PORT/blocks/tip/height" "esplora :$ESPLORA_PORT" 120
wait_listen "http://127.0.0.1:$PROXY_PORT/" "rgb proxy :$PROXY_PORT" 60
btc loadwallet "$BTC_WALLET" >/dev/null 2>&1 || true

# ── 1b. optional VSS server (VSS=1, like regtest.sh) ──────────────────────────
if [ "${VSS:-}" = "1" ]; then
  log "starting vss-server (root compose, profile vss) …"
  docker compose -f "$ROOT_COMPOSE" --profile vss up -d vss-server
  # vss-server has no GET health route — any HTTP response means it's listening.
  wait_listen "http://127.0.0.1:$VSS_PORT/vss/getObject" "vss-server :$VSS_PORT" 120
fi

# ── 2. wasm-proxy-gateway via cargo ───────────────────────────────────────────
pkill -f "wasm-proxy-gateway" 2>/dev/null || true
log "starting wasm-proxy-gateway (cargo) on :$GATEWAY_PORT …"
( cd "$RGBLN_REPO" && env \
    WASM_PROXY_LISTEN_ADDR="0.0.0.0:$GATEWAY_PORT" \
    WASM_PROXY_RELAY_AUTH_REQUIRED="false" \
    WASM_PROXY_RGB_UPSTREAM="http://127.0.0.1:$PROXY_PORT/json-rpc" \
    WASM_PROXY_CORS_ALLOW_ORIGINS="$DEV_ORIGIN,http://127.0.0.1:5173" \
    WASM_PROXY_REGTEST_FUNDING_ENABLED="true" \
    WASM_PROXY_REGTEST_FUNDING_USE_BITCOIN_RPC="true" \
    WASM_PROXY_BITCOIN_RPC_URL="http://127.0.0.1:$ESPLORA_BTC_RPC" \
    WASM_PROXY_BITCOIN_RPC_USER="$BTC_RPC_USER" \
    WASM_PROXY_BITCOIN_RPC_PASSWORD="$BTC_RPC_PASS" \
    WASM_PROXY_BITCOIN_RPC_WALLET="$BTC_WALLET" \
    WASM_PROXY_REGULAR_RLN_API_BASE="http://127.0.0.1:$FAUCET_PORT" \
    cargo run -q -p wasm-proxy-gateway --features dev-http \
    >"$LOGS/web-gateway.log" 2>&1 ) &
echo $! > "$GATEWAY_PIDFILE"
# First run compiles the gateway crate — allow generous time.
wait_http "http://127.0.0.1:$GATEWAY_PORT/healthz" "gateway :$GATEWAY_PORT" 900

# ── 3. LSP + Faucet RLN daemons ───────────────────────────────────────────────
start_rln() { # data_suffix port peer_port extra_args...
  local suffix=$1 port=$2 peer=$3; shift 3
  local dir="$RGBLN_REPO/data_${suffix}"
  pkill -f "rgb-lightning-node.*data_${suffix}" 2>/dev/null || true
  sleep 1; rm -rf "$dir"; mkdir -p "$dir"
  log "starting RLN daemon $suffix (REST :$port peer :$peer) …"
  "$RLN_BIN" "$dir" \
    --daemon-listening-port "$port" \
    --ldk-peer-listening-port "$peer" \
    --network regtest \
    --disable-authentication \
    --enable-virtual-channels-v0 \
    "$@" \
    >"$LOGS/rln-${suffix}.log" 2>&1 &
  wait_rln "$port" "RLN $suffix"
}

start_rln lsp_web    "$LSP_PORT"    "$LSP_PEER_PORT" \
  --lsp-base-url "http://127.0.0.1:$UTEXO_PORT" --lsp-bearer-token "$APAY_BEARER_TOKEN"
start_rln faucet_web "$FAUCET_PORT" "$FAUCET_PEER_PORT"

log "init + unlock LSP and Faucet …"
rln_post "$LSP_PORT"    /init   "{\"password\":\"$PASSWORD\"}" >/dev/null
rln_post "$FAUCET_PORT" /init   "{\"password\":\"$PASSWORD\"}" >/dev/null
rln_post "$LSP_PORT"    /unlock "$UNLOCK_BODY" >/dev/null
rln_post "$FAUCET_PORT" /unlock "$UNLOCK_BODY" >/dev/null
wait_rln_unlocked "$LSP_PORT"
wait_rln_unlocked "$FAUCET_PORT"

LSP_PUBKEY=$(rln_get "$LSP_PORT" /nodeinfo | jq -r '.pubkey')
log "LSP pubkey: $LSP_PUBKEY"

# ── 4. fund both nodes + create UTXOs ─────────────────────────────────────────
LSP_ADDR=$(rln_post "$LSP_PORT" /address | jq -r '.address')
FAUCET_ADDR=$(rln_post "$FAUCET_PORT" /address | jq -r '.address')
log "funding LSP + Faucet (1 BTC each) …"
btc_send "$LSP_ADDR" 1 >/dev/null
btc_send "$FAUCET_ADDR" 1 >/dev/null
btc_mine 6; sleep 3
wait_btc "$LSP_PORT"    "LSP"
wait_btc "$FAUCET_PORT" "Faucet"

UTXO_BODY='{"up_to":false,"num":10,"size":null,"fee_rate":7,"skip_sync":false}'
log "creating UTXOs on LSP + Faucet …"
rln_post "$LSP_PORT"    /createutxos "$UTXO_BODY" >/dev/null
rln_post "$FAUCET_PORT" /createutxos "$UTXO_BODY" >/dev/null
btc_mine 1; sleep 2

# ── 5. issue RGB asset on Faucet ──────────────────────────────────────────────
log "issuing RGB asset on Faucet …"
ISSUE=$(rln_post "$FAUCET_PORT" /issueassetnia '{"ticker":"UTST","name":"UTEXO LSP Test","precision":0,"amounts":[1000]}')
ASSET_ID=$(echo "$ISSUE" | jq -r '.asset.asset_id // .asset_id // empty')
[ -n "$ASSET_ID" ] || die "could not parse asset_id from: $ISSUE"
log "asset: $ASSET_ID"
btc_mine 1; sleep 2
wait_asset "$FAUCET_PORT" "$ASSET_ID" 6 "Faucet"

# ── 6. seed LSP with 6 RGB units from Faucet ──────────────────────────────────
log "seeding LSP with 6 RGB units …"
for i in 1 2 3 4 5 6; do
  wait_asset "$FAUCET_PORT" "$ASSET_ID" 1 "Faucet"
  EXP=$(( $(date +%s) + 3600 ))
  INV=$(rln_post "$LSP_PORT" /rgbinvoice "{\"assignment\":{\"type\":\"Any\"},\"expiration_timestamp\":$EXP,\"min_confirmations\":1,\"witness\":false}")
  RID=$(echo "$INV" | jq -r '.recipient_id')
  [ -n "$RID" ] || die "no recipient_id in: $INV"
  SEND=$(printf '{"donation":true,"fee_rate":7,"min_confirmations":1,"skip_sync":false,"recipient_map":{"%s":[{"recipient_id":"%s","assignment":{"type":"Fungible","value":1},"transport_endpoints":["%s"]}]}}' \
    "$ASSET_ID" "$RID" "$PROXY_ENDPOINT")
  rln_post "$FAUCET_PORT" /sendrgb "$SEND" >/dev/null
  btc_mine 1; sleep 2
  for p in "$LSP_PORT" "$FAUCET_PORT"; do
    rln_post "$p" /refreshtransfers '{"filter":[],"skip_sync":false}' >/dev/null 2>&1 || true
    rln_post "$p" /refreshtransfers '{"filter":[],"skip_sync":false}' >/dev/null 2>&1 || true
  done
  log "  seed $i/6"
done
LSP_BAL=$(rln_post "$LSP_PORT" /assetbalance "{\"asset_id\":\"$ASSET_ID\"}" | jq '.settled // 0')
log "LSP settled balance: $LSP_BAL"

# ── 7. utexo-lsp ──────────────────────────────────────────────────────────────
pkill -f "go run \." 2>/dev/null || true; pkill -f "utexo-lsp" 2>/dev/null || true; sleep 2
rm -f "$UTEXO_LSP_REPO/utexo_lsp.db"
log "starting utexo-lsp on :$UTEXO_PORT (SUPPORTED_ASSET_IDS=$ASSET_ID) …"
( cd "$UTEXO_LSP_REPO" && env \
    SERVER_ADDR=":$UTEXO_PORT" \
    LSP_BASE_URL="http://127.0.0.1:$LSP_PORT" \
    RGB_NODE_BASE_URL="http://127.0.0.1:$LSP_PORT" \
    LIGHTNING_ADDRESS_DOMAIN_URL="http://127.0.0.1:$UTEXO_PORT" \
    SUPPORTED_ASSET_IDS="$ASSET_ID" \
    CRON_EVERY="5s" \
    DEFAULT_CHANNEL_CAPACITY_SAT="200000" \
    DEFAULT_CHANNEL_PUSH_MSAT="5000000" \
    DEFAULT_CHANNEL_ASSET_AMOUNT="2" \
    DEFAULT_VIRTUAL_OPEN_MODE="${LSP_VIRTUAL_OPEN_MODE-trusted_no_broadcast}" \
    MIN_AMT_MSAT="3000000" \
    EXPIRY_MATCH_TOLERANCE_SEC="30" \
    UTXO_MIN_COUNT="15" UTXO_TARGET_COUNT="25" \
    APAY_BEARER_TOKEN="$APAY_BEARER_TOKEN" \
    APAY_OUTBOUND_MIN_FINAL_CLTV_EXPIRY_DELTA="42" \
    go run . >"$LOGS/utexo-lsp.log" 2>&1 ) &
wait_http "http://127.0.0.1:$UTEXO_PORT/health" "utexo-lsp :$UTEXO_PORT" 150

# ── 8. write web env ──────────────────────────────────────────────────────────
if [ -f "$ENV_LOCAL" ]; then
  # NOTE: -E, not basic-regex "\|" — BSD grep (macOS) has no alternation in BRE,
  # which silently kept every stale entry and accumulated old asset ids.
  # NOTE 2: grep exits 1 when nothing survives the filter (file is all VITE_
  # lines) — must not skip the mv then, or stale blocks accumulate forever and
  # Vite's dotenv keeps the OLDEST duplicate key, not the newest.
  grep -Ev "^VITE_(LSP|RLN|FAUCET|VSS)_" "$ENV_LOCAL" > "$ENV_LOCAL.tmp" || true
  mv "$ENV_LOCAL.tmp" "$ENV_LOCAL"
fi
# VSS URL is same-origin via the Vite /vss proxy (vss-server has no CORS);
# only written when the local server is up, so demos never hit prod by accident.
if [ "${VSS:-}" = "1" ]; then
  echo "VITE_VSS_URL=\"/vss\"" >> "$ENV_LOCAL"
fi
cat >> "$ENV_LOCAL" <<EOF
VITE_LSP_REGTEST_ASSET_ID="$ASSET_ID"
VITE_LSP_REGTEST_PEER_PUBKEY="$LSP_PUBKEY"
VITE_LSP_REGTEST_LDK_PORT="$LSP_PEER_PORT"
VITE_LSP_BASE_URL="/lsp"
VITE_RLN_GATEWAY_WS="ws://127.0.0.1:$GATEWAY_PORT"
VITE_RLN_TRANSPORT="http://127.0.0.1:$GATEWAY_PORT/rgb/json-rpc"
VITE_RLN_INDEXER="http://127.0.0.1:$ESPLORA_PORT"
VITE_RLN_GATEWAY_HTTP="http://127.0.0.1:$GATEWAY_PORT"
VITE_FAUCET_RLN_VIA_GATEWAY="http://127.0.0.1:$GATEWAY_PORT/dev/regular-rln"
VITE_FAUCET_LDK_PORT="$FAUCET_PEER_PORT"
EOF

log ""
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "  LSP regtest stack ready"
log "  gateway:   http://127.0.0.1:$GATEWAY_PORT   (ws LN + rgb json-rpc + funding)"
log "  utexo-lsp: http://127.0.0.1:$UTEXO_PORT"
log "  LSP:       http://127.0.0.1:$LSP_PORT  (pubkey $LSP_PUBKEY, peer :$LSP_PEER_PORT)"
log "  Faucet:    http://127.0.0.1:$FAUCET_PORT  (peer :$FAUCET_PEER_PORT)"
[ "${VSS:-}" = "1" ] && log "  VSS:       http://127.0.0.1:$VSS_PORT/vss  (browser: /vss via Vite proxy)"
log "  asset:     $ASSET_ID"
log "  env →      $ENV_LOCAL"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "  npm run dev → open LSP & APay page in TWO windows (Recipient + Sender)"
log "  stop with:  ./scripts/start-lsp-regtest.sh stop"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
