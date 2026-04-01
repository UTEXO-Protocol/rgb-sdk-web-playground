# RGB SDK Web Playground

Interactive playground that demonstrates every function of the [`@utexo/rgb-sdk-web`](https://github.com/UTEXO-Protocol/rgb-sdk-web) WASM library — running entirely in the browser.

## What it covers

- **Keys** — generate, restore, and derive keys from mnemonic (BIP39)
- **Wallet** — create and manage `WalletManager` and `UTEXOWallet` instances across signet, testnet, testnet4, regtest, and mainnet
- **Bitcoin** — send BTC via 3-step PSBT flow (begin → sign → broadcast), fee estimation, regtest faucet funding
- **RGB Assets** — issue NIA/IFA assets, generate blind/witness receive invoices, send assets
- **Backup** — file-based backup/restore and VSS cloud backup

## Getting started

```bash
# Install dependencies
npm install

# Copy env file and adjust if using regtest
cp .env.example .env

# Start dev server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Environment

All variables are optional — defaults point to localhost regtest infrastructure.

| Variable | Default | Description |
|---|---|---|
| `VITE_REGTEST_INDEXER_URL` | `http://localhost:8094/regtest/api` | Esplora indexer |
| `VITE_REGTEST_PROXY_HTTP_URL` | `http://localhost:3000/json-rpc` | RGB proxy (HTTP) |
| `VITE_REGTEST_PROXY_RPC_URL` | `rpc://localhost:3000/json-rpc` | RGB proxy (RPC) |
| `VITE_REGTEST_BITCOIND_URL` | `/bitcoind/wallet/miner` | bitcoind RPC |
| `VITE_REGTEST_BITCOIND_USER` | `user` | bitcoind user |
| `VITE_REGTEST_BITCOIND_PASS` | `password` | bitcoind password |

## Stack

- [React](https://react.dev) + [TypeScript](https://www.typescriptlang.org)
- [Vite](https://vitejs.dev) + [vite-plugin-wasm](https://github.com/Menci/vite-plugin-wasm)
- [Tailwind CSS](https://tailwindcss.com)
- [`@utexo/rgb-sdk-web`](https://github.com/UTEXO-Protocol/rgb-sdk-web) — local sibling package
