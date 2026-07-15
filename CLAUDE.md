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

The SDK is **RLN-only** (the old rgb-lib-wasm `WalletManager` stack was removed). All wallets are backed by `rln-wasm-sdk`.

**Startup flow**: `App.tsx` calls `initRlnWasm()` (async WASM init), then `autoRestore()` to recover wallets from `localStorage`. The Zustand store in `src/store.ts` holds live wallet instances (`type: 'utexo' | 'rln'`, instance `UTEXOWallet | RlnWalletManager`) plus an activity log. Instances **must** live in Zustand (not React state) — WASM objects cannot be cloned/serialized. Both wallet types restore via `*.create({ mnemonic, password, network, indexerUrl?, transportEndpoint?, proxyUrl?, nodeRuntimeId? })`, so the saved `WalletConfig` must include `password`. `create()` auto-connects to the indexer (saved `indexerUrl` or the network default) non-fatally — check `isOnline()` afterwards; no separate `goOnline()` call is needed.

**Pages** (one route each in `App.tsx`):
- `KeysPage` — `generateKeys`, `restoreKeys`, `deriveKeysFromMnemonic`, `bip39`
- `UtexoWalletPage` — **primary**: create + full `UTEXOWallet` surface (RGB on-chain + Lightning), backed by RLN
- `UtexoBackupPage` (`/backup`) — file backup (`createBackup`/`getLastBackupBytes`/`restoreFromBackupBytes`) + VSS

`BitcoinPage`, `RgbAssetsPage`, `RlnWalletPage`, and `RlnFlowGuidePage` were removed — they duplicated `UtexoWalletPage`'s coverage of BTC send, RGB issue/send/receive, and Lightning at the lower `RlnWalletManager`/`IRlnNodeBinding` layer. `UTEXOWallet` does not re-expose `sendBeginBatch`/`sendBatch`/`sendRgbFromGroups` (batch/group RGB send) — use `RlnWalletManager` directly for that if needed.

**Reusable components** worth knowing:
- `StepFlow.tsx` — 3-step Begin → Sign → Broadcast UI; steps unlock sequentially; has an "Auto" button that runs all 3 at once
- `OutputBox.tsx` — `<pre>` display with Copy button
- `Field.tsx`, `Section.tsx`, `Btn.tsx` — form/layout primitives

**Session persistence** (`src/lib/session.ts`): saves wallet entries (incl. `WalletConfig` with `password`) to `localStorage['rgb_wallet_sessions']`; active id in `sessionStorage['rgb_active_wallet_id']`.

## Critical Vite Config Rules

`vite.config.ts` plugin order is **mandatory**:
1. `nodePolyfills({ globals: { Buffer: true, process: true } })` — must be **first** (bitcoinjs-lib crashes without Buffer)
2. `wasm()`
3. `topLevelAwait()`
4. `react()`

`optimizeDeps.exclude` must list `@utexo/rgb-sdk-web` and sibling packages — Vite's pre-bundler breaks async WASM init if they're included.

`server.fs.allow` must include sibling monorepo paths (`../rgb-sdk-web`, `../rgb-sdk-core`, `../../utexo/rgb-lightning-node/bindings/wasm-sdk/pkg`) so Vite can serve their WASM files.

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
