# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start Vite dev server on port 5173
npm run build     # TypeScript check + Vite production build
npm run preview   # Preview production build locally
```

No test suite exists — this is a demo application.

## What This Is

Interactive React SPA that demos every function of the `@utexo/rgb-sdk-web` WASM library. The SDK is a local sibling package (`../rgb-sdk-web`), not from npm.

## Architecture

**Startup flow**: `App.tsx` calls `initWasm()` (async WASM init), then `autoRestore()` to recover wallets from `sessionStorage`. The Zustand store in `src/store.ts` holds the live WASM wallet instances (`manager: WalletManager | null`, `utexo: UTEXOWallet | null`) plus an activity log. Wallet instances **must** live in Zustand (not React state) because WASM objects cannot be cloned/serialized.

**Pages** (one route each in `App.tsx`):
- `KeysPage` — `generateKeys`, `restoreKeys`, `deriveKeysFromMnemonic`, `bip39`
- `WalletManagerPage` — full `WalletManager` lifecycle (create, go online, UTXO ops, BTC send)
- `UtexoWalletPage` — `UTEXOWallet` (dual-layer wallet with optional transport endpoint)
- `BitcoinPage` — BTC send (3-step PSBT), faucet funding, fee estimation
- `RgbAssetsPage` — issue NIA/IFA assets, blind/witness receive invoices, send assets
- `BackupPage` — file backup/restore, VSS cloud backup

**Reusable components** worth knowing:
- `StepFlow.tsx` — 3-step Begin → Sign → Broadcast UI; steps unlock sequentially; has an "Auto" button that runs all 3 at once
- `OutputBox.tsx` — `<pre>` display with Copy button
- `Field.tsx`, `Section.tsx`, `Btn.tsx` — form/layout primitives

**Session persistence** (`src/lib/session.ts`): saves `{ type, mnemonic, network, transportEndpoint, indexerUrl }` to `sessionStorage['rgb_wallet_session']`. Cleared when browser session ends.

## Critical Vite Config Rules

`vite.config.ts` plugin order is **mandatory**:
1. `nodePolyfills({ globals: { Buffer: true, process: true } })` — must be **first** (bitcoinjs-lib crashes without Buffer)
2. `wasm()`
3. `topLevelAwait()`
4. `react()`

`optimizeDeps.exclude` must list `@utexo/rgb-sdk-web` and sibling packages — Vite's pre-bundler breaks async WASM init if they're included.

`server.fs.allow` must include sibling monorepo paths (`../rgb-sdk-web`, `../rgb-lib-wasm`, `../rgb-sdk-core`) so Vite can serve their WASM files.

## SDK Patterns

All SDK calls are async. The standard BTC/asset send flow is always 3 steps:
```typescript
const unsigned = await wallet.sendBtcBegin({ address, amount, feeRate });
const signed   = await wallet.signPsbt(unsigned);   // signs with embedded mnemonic
const txid     = await wallet.sendBtcEnd(signed);
```

`UTEXOWallet` vs `WalletManager`: UTEXOWallet supports mainnet and has a `transportEndpoint`; WalletManager is signet/testnet/regtest only. Both share the same method surface (`goOnline`, `getAddress`, `listAssets`, etc.).

Backup bytes are returned as `Uint8Array`. Use `downloadBytes()` from `src/lib/utils.ts` to trigger a browser download.

## Supported Networks

`signet` (default), `testnet`, `regtest`, `mainnet` (UTEXOWallet only). Default indexer URLs and transport endpoints are exported from `@utexo/rgb-sdk-web`.
