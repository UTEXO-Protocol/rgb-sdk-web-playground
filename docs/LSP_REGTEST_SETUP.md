# LSP Regtest Setup (web demo)

How to run the full LSP / APay Lightning flow of this web demo against a local
regtest chain, from scratch. This mirrors the React Native sandbox setup, but
adapted for the browser: the wasm node cannot open raw TCP sockets or shell out
to `bitcoin-cli`, so everything the browser touches is bridged by a local
**wasm-proxy-gateway**.

Everything is driven by [`scripts/start-lsp-regtest.sh`](../scripts/start-lsp-regtest.sh).

---

## What gets started

All services run on the one regtest chain defined in
`rgb-lightning-node/bindings/wasm-sdk/compose.wasm.yaml`:

| Service | Port | Role |
|---|---|---|
| bitcoind / electrs | (compose) | regtest chain + electrum |
| rgb proxy | `3000` | RGB consignment transport (JSON-RPC) |
| esplora | `3002` (btc rpc `18444`) | HTTP indexer used by RLN nodes + wasm wallets |
| **wasm-proxy-gateway** | `3001` | bridges browser → LN P2P over WebSocket, RGB JSON-RPC, and regtest funding |
| LSP RLN node | `3105` (peer `9745`) | the LSP daemon (`--lsp-base-url` → utexo-lsp) |
| Faucet RLN node | `3108` (peer `9748`) | issues + seeds the RGB test asset |
| utexo-lsp | `8080` | Go LSP service (channel automation) |
| vss-server (optional, `VSS=1`) | `8081` | cloud backup; browser reaches it via the Vite `/vss` proxy |

The two browser windows (Recipient + Sender) each create one `UTEXOWallet` and
talk Lightning to the LSP through the gateway; the LSP routes between them.

---

## Repos you need

Clone these side by side (e.g. all under `~/rgb/`):

```bash
git clone https://github.com/UTEXO-Protocol/rgb-lightning-node.git
git clone https://github.com/UTEXO-Protocol/utexo-lsp.git
git clone https://github.com/UTEXO-Protocol/rgb-sdk-web-demo.git   # this repo
```

```
rgb-lightning-node/   ← regtest docker stack + RLN binary + wasm-proxy-gateway
utexo-lsp/            ← Go LSP service
rgb-sdk-web-demo/     ← this repo, the web demo app
```

---

## Prerequisites

```bash
# macOS
brew install go jq node docker

# Rust (for building the RLN binary + wasm-proxy-gateway)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Docker must be running (the compose stack needs it).

---

## Step 1 — Build the RLN binary

```bash
cd rgb-lightning-node
cargo build --release --bin rgb-lightning-node
```

Takes a few minutes on first run. The `wasm-proxy-gateway` is compiled
automatically the first time the setup script runs (`cargo run …`), which is why
that step can take a while initially.

---

## Step 2 — Set environment variables

The setup script does **not** hardcode any paths — point it at your two sibling
repos (add to `~/.zshrc` / `~/.bashrc` to persist):

```bash
export RGBLN_REPO=/absolute/path/to/rgb-lightning-node
export UTEXO_LSP_REPO=/absolute/path/to/utexo-lsp
```

---

## Step 3 — Install web demo dependencies

```bash
# from rgb-sdk-web-demo root
npm install
```

---

## Step 4 — Run the LSP regtest setup script

```bash
# from rgb-sdk-web-demo root
./scripts/start-lsp-regtest.sh
```

This script:

1. Starts the `compose.wasm.yaml` infra (bitcoind, electrs, rgb proxy, esplora)
2. Starts the `wasm-proxy-gateway` on `:3001` (compiles it on first run)
3. Starts a fresh LSP RLN node and a Faucet RLN node (kills any previous ones)
4. Initializes and unlocks both nodes
5. Funds both nodes (1 BTC each) from the regtest chain, then creates UTXOs
6. Issues a new RGB test asset (`UTST`) on the Faucet
7. Seeds the LSP with 6 units of that asset
8. Starts `utexo-lsp` (first run compiles Go deps — allow ~60 s)
9. Writes the live asset id, LSP pubkey, gateway/indexer URLs, etc. into
   `.env.local` (Vite auto-loads it)

Add `VSS=1` to also bring up the local `vss-server` for cloud-backup demos:

```bash
VSS=1 ./scripts/start-lsp-regtest.sh
```

Expected final output:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  LSP regtest stack ready
  gateway:   http://127.0.0.1:3001   (ws LN + rgb json-rpc + funding)
  utexo-lsp: http://127.0.0.1:8080
  LSP:       http://127.0.0.1:3105  (pubkey 02…, peer :9745)
  Faucet:    http://127.0.0.1:3108  (peer :9748)
  asset:     rgb:…
  env →      /…/rgb-sdk-web-demo/.env.local
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Step 5 — Run the demo app

```bash
# from rgb-sdk-web-demo root
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and go to the **LSP & APay**
page. To exercise a payment between two wallets, open the page in **two browser
windows** (e.g. one normal + one incognito):

- **Recipient** — creates a wallet, gets an LSP channel, generates an invoice
- **Sender** — creates a wallet and pays that invoice through the LSP

The Vite dev server proxies same-origin paths to the local services (see
`vite.config.ts`): `/lsp` → utexo-lsp `:8080`, `/vss` → vss-server `:8081`,
`/bitcoind` → esplora bitcoind RPC `:18444`.

---

## Stopping everything

```bash
./scripts/start-lsp-regtest.sh stop
```

This kills the gateway, the LSP + Faucet RLN daemons, utexo-lsp, tears down the
`compose.wasm.yaml` stack, and (if it was started) the VSS server.

---

## Troubleshooting

**`Set RGBLN_REPO …` / `Set UTEXO_LSP_REPO …`**
You didn't export the two repo paths — see Step 2.

**`RLN binary missing`**
Run `cargo build --release --bin rgb-lightning-node` in `rgb-lightning-node`
(Step 1).

**`compose file missing`**
`RGBLN_REPO` points at the wrong directory, or you have an old checkout without
`bindings/wasm-sdk/compose.wasm.yaml`.

**Gateway takes a long time on first run**
Normal — `cargo run -p wasm-proxy-gateway` compiles the crate the first time
(the script waits up to 15 min).

**utexo-lsp takes >60 s to start**
Normal on first run while Go downloads and compiles dependencies.

**Stale asset id / wallet after a re-run**
Each run issues a fresh asset and rewrites the `VITE_LSP_*` / `VITE_RLN_*` /
`VITE_FAUCET_*` keys in `.env.local`. Restart `npm run dev` and reset any wallet
you created in the browser (old wallets reference the previous asset id).

**`InsufficientAssets` / stuck sends**
Reset / cancel any active demo flow in the browser, then re-run
`./scripts/start-lsp-regtest.sh` for a clean LSP + Faucet seed.

---

## Logs

Daemon logs are written under `rgb-lightning-node/logs/`:

```
logs/web-gateway.log   # wasm-proxy-gateway
logs/rln-lsp_web.log   # LSP RLN node
logs/rln-faucet_web.log # Faucet RLN node
logs/utexo-lsp.log     # utexo-lsp Go service
```
