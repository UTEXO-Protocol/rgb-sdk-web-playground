# APay Cart Checkout — Web Demo Plan (feasibility + changes)

Mission: port the RN demo's guided "APay Cart Checkout" UX
(`rgb-sdk-rn-demo/screens/apay-regular-channels.tsx` + `screens/apay/useApayFlow.ts`)
to `rgb-sdk-web-demo`.

Decisions taken:
- **Virtual channels (RN parity)** — the flow uses LSP-opened virtual channels
  (`trusted_no_broadcast`), same as the RN regtest demo, NOT browser-opened real channels.
- **Two windows** — one RLN wallet per browser window (prior team decision; recipient +
  sender in one window is not reliable). Run 1 = Merchant window, Run 2 = Buyer window,
  coordinated over BroadcastChannel (the proven `RegtestLspFlow` pattern).

---

## 0. Prerequisite — the wasm inbound-accept fix (blocking, must land first)

The RN flow's backbone is: `lsp.connect()` → **LSP opens a virtual channel to the
client** → `waitForChannel()`. In the browser this is currently broken:

> `rgb-sdk-web/LSP_ACCEPT_PROBLEM_EN.md` — the wasm node auto-accepts inbound channels
> with one fixed LDK config (private + dust ≥ 354). The LSP's virtual open (dust=1) and
> regular open (public) are both rejected during the handshake. Root cause:
> `bindings/wasm-sdk/src/ldk_live_backend.rs:1199`. Fix NOT implemented.

Verified during this planning pass:
- `setEnableVirtualChannelsV0(true)` (already called by `RlnWasmBinding.create`, and its
  code comment claims it enables accepting LSP virtual channels) **does not do that** —
  the flag is consumed only in `ln_node.rs` (gates *outbound* virtual opens and virtual
  closes); it has **zero references** in `ldk_live_backend.rs`/`ldk_runtime.rs`, so it
  never reaches the LDK inbound-accept path. The SDK comment is aspirational.
- Therefore the existing `RegtestLspFlow.tsx` is also broken at its `channel` phase today.

**Why wasm-only:** the uniffi bindings (RN, kotlin-android-sdk, c-ffi) wrap the *full
native node* — the same `src/ldk.rs` as the daemon, which already has manual accept +
the `Event::OpenChannelRequest` handler (`src/ldk.rs:2436-2520`: `virtual_peer_pubkeys`
trust check, SCID-privacy check, `accept_inbound_channel_from_trusted_peer_0conf(...,
ChannelFundingType::Virtual)`). The wasm-sdk is a browser *reimplementation* of the LDK
node (`ldk_live_backend.rs`) and this logic was never ported. So work item 0 is a
**port of the native handler**, with `ldk.rs` as the reference implementation — not new
protocol work.

**Work item 0 (in `rgb-lightning-node/bindings/wasm-sdk`, per the problem doc):**
1. `ldk_live_backend.rs` UserConfig: `manually_accept_inbound_channels = true`,
   `channel_handshake_limits.force_announced_channel_preference = false`.
2. Handle `Event::OpenChannelRequest` → `accept_inbound_channel_from_trusted_peer_0conf`
   (mirroring native `src/ldk.rs:2436-2519`), gated on the node's
   `enable_virtual_channels_v0` flag (plumb it from `ln_node.rs` into the backend).
3. ⚠️ Likely also needed beyond the doc: register the accepted inbound channel in the
   wasm virtual-session bookkeeping (`virtual_channel_session_*` /
   `register_trusted_virtual_scope_channel` are today only wired on the *outbound*
   open path in `ln_node.rs`), so `listChannels` reports it usable and HTLCs route.
4. Rebuild: `wasm-pack build --target web` (macOS: Homebrew LLVM clang via
   `CC_wasm32_unknown_unknown`) → `rgb-sdk-web: npm run build`.

**Acceptance for item 0:** the *existing* `RegtestLspFlow` two-window demo passes its
`channel` phase (connect → LSP opens virtual channel → `waitForChannel` returns usable)
— no demo-repo changes needed to verify this.

**Status (2026-07-02): code landed, pkg + SDK rebuilt; runtime verification against the
LSP stack pending.** Implemented in `bindings/wasm-sdk`: manual accept + announce-
preference relaxation in the backend UserConfig; `Event::OpenChannelRequest` handler
(virtual+scid_privacy → `accept_inbound_channel_from_trusted_peer_0conf(...,
ChannelFundingType::Virtual)`, everything else → stock `accept_inbound_channel` to keep
the native→wasm interop flows working); flag plumbed per runtime-key from
`RlnWasmNode::setEnableVirtualChannelsV0` (and node construction). Bonus for the flow:
`listChannels` now enriches live channels with `asset_id`/`asset_local_amount` from the
RGB kv store (covers inbound/LSP-opened channels, needed by `waitForChannel`) and with
live `outbound/inbound_balance_msat` (needed by `waitForOutboundLiquidity`).

Fallback if item 0 stalls: browser-opened **real RGB channels** (outbound colored opens
are auto-funded internally and proven in `wasm-interop`; merchant keysends RGB to the
LSP to seed inbound liquidity; buyer gets RGB on-chain from the faucet instead of
`receiveAsset`). Kept out of this plan's main path per the virtual-channels decision;
details preserved in git history of this file.

---

## 1. Feasibility check per mission item (with item 0 landed)

| Mission item | Verdict |
|---|---|
| Guided one-scenario UI, phases, Run button, info cards, log pane, env badge, done card, reset | ✅ Pure React port of `screens/apay/ui.tsx` + `config.ts`. |
| `lsp.connect()` → `waitForChannel()` (LSP opens virtual channel, pushes msat + RGB) | ✅ After item 0. `start-lsp-web.sh` already provisions it: LSP RLN runs `--enable-virtual-channels-v0`, utexo-lsp has `DEFAULT_VIRTUAL_OPEN_MODE=trusted_no_broadcast`, `DEFAULT_CHANNEL_PUSH_MSAT=5000000`, `DEFAULT_CHANNEL_ASSET_AMOUNT=2` — the LSP-side 2 RGB gives the merchant inbound RGB capacity (no keysend seeding needed, same as RN). Virtual = 0-conf, so no funding confirmations to mine for the channel itself. |
| `enableVirtualChannelsV0` on client wallets (RN regtest param) | ✅ Already default-on in `RlnWasmBinding.create` (`enableVirtualChannels ?? true`, SDK + node level). RN's `virtualPeerPubkeys` has no web equivalent — under item 0's trusted-accept it is not needed (accept is gated on the flag; if we want peer scoping later, add it in the wasm fix). |
| Buyer top-up: `lsp.receiveAsset` + faucet on-chain RGB send + `awaitReceiveSettlement` (RN `a_topup`) | ✅ Same semantics as RN. Faucet's `decodergbinvoice` + `sendrgb` go through the gateway proxy `POST /dev/regular-rln/*` (→ Faucet RLN :3108, wired by `start-lsp-web.sh`) instead of RN's direct daemon HTTP. |
| RN polls `lspDaemon.listTransfers` + `faucet.listTransfers` for topup diagnostics | ⚠️ Faucet side: available via `/dev/regular-rln/listtransfers`. LSP side: **drop** — the gateway does not proxy the LSP RLN (:3105) and browsers hit CORS on direct RLN REST. Rely on `awaitReceiveSettlement` + faucet transfer status. |
| `enableLightningAddress` / `refillHashPool` / merchant keepalive (`lsp.connect` every 15 s) | ✅ `UtexoLsp` implements all of it; APay registration runs over LN custom msg 37915 through the gateway WS relay (proven in `wasm-interop` apay flow). |
| `payAddress` (LNURL-pay → HODL at LSP) + poll `getLightningSendRequest` until Settled | ✅ `UtexoLsp.payAddress` resolves via the LSP HTTP client through the `/lsp` Vite proxy (the `https://` LNURL fallback is never hit on regtest). Web `getLightningSendRequest` returns the status string, as RN uses it. |
| Final settlement (LSP outbox pays merchant; merchant never calls `claimHodlInvoice`) | ⚠️ Best-effort, same as RN: success = buyer `Settled` **and** (merchant `offchainOutbound` increased **or** merchant inbound Succeeded/Claimable). Stock RLN may reject the host-forward with `PaymentHashAlreadyUsed` (wasm-interop README) — but the web stack uses the same locally built RLN binary as the RN stack, so behavior matches RN. Log soft-failures; don't fail the run on slow LSP cron. |
| `mine()` / `sendToAddress` | ✅ Different mechanism, already solved: `gatewayFund(address, btc, mineBlocks)` (`POST /dev/regtest/fund`), incl. mining-on-poll via `onEachPoll` — reuse the `RegtestLspFlow` helper. |
| Both wallets in one tab, single Run button | ❌ Ruled out (team decision, one RLN wallet per window). **Two windows** — see §3. |
| Fresh `dataDir` + `nodeRuntimeId` per run, stable mnemonic per role, `clearWalletsAndReload` | ✅ Reuse the exact `RegtestLspFlow` patterns. |
| Keep `start-lsp-web.sh`, Vite config, other pages intact | ✅ No changes needed; env vars already sufficient. |

---

## 2. Web flow choreography (mirrors RN `useApayFlow` cart variant)

Phase names, order, and `→ req` / `← res` log format match RN `screens/apay/config.ts`
for cross-demo debugging.

**Merchant window (Bob)** — `b_init → b_fund → b_utxos → b_channel → register`
1. `b_init` — `UTEXOWallet.create` (fresh `dataDir`/`nodeRuntimeId` = `Date.now().toString(16)`,
   stable per-role mnemonic in localStorage, `lspBaseUrl`, gateway `proxyUrl`/`transportEndpoint`)
   → `goOnline(indexer, true)`.
2. `b_fund` — `gatewayFund(addr, 1, 6)` + poll spendable.
3. `b_utxos` — `createUtxos({num:10, feeRate:7})` + `gatewayFund(addr, 0.001, 1)` + sync.
4. `attachLightningNode()` → `createLsp(peer from env)` → `lsp.connect()`.
5. `b_channel` — `lsp.waitForChannel(assetId, {onEachPoll: gatewayFund(addr, 0.001, 1)})` —
   the LSP cron opens the virtual channel (usable ~immediately; the mining poll stays as a
   harmless keep-the-chain-moving beat, matching RN's `mine(1)` on poll).
6. `register` — `lsp.connect()` again (virtual channels may drop TCP, per RN comment) →
   `lsp.enableLightningAddress()` → broadcast the address → start keepalive
   `setInterval(lsp.connect, 15_000)` + auto `refillHashPool` when `unusedHashes < 3` →
   settle watcher (see below).

**Buyer window (Alice)** — `a_init → a_fund → a_utxos → a_channel → a_topup → send → settle`
1–3. Same as merchant (own mnemonic/dataDir).
4. `a_channel` — connect + `waitForChannel` (LSP opens virtual channel to the buyer too).
5. `a_topup` — RN parity: `lsp.receiveAsset({assetId, amountSats: 3000, amountRgb: 1})` →
   decode the returned `rgbInvoice` via gateway `/dev/regular-rln/decodergbinvoice` →
   faucet `/dev/regular-rln/sendrgb` to that recipient → `gatewayFund(addr, 0.001, 1)` →
   poll faucet `/dev/regular-rln/listtransfers` for the Send reaching `Settled` (LSP-side
   polling dropped, §1) → `lsp.awaitReceiveSettlement(lnInvoice)` and require last status
   `Succeeded` (RN's compiled-SDK caveat: verify via `onProgress`, not the return value).
6. `lsp.waitForOutboundLiquidity(3_000_000)` — sanity gate before paying.
7. `send` — `lsp.payAddress({address, amtMsat: 3_000_000, asset: {assetId, assetAmount: 1}})`;
   record HODL invoice + paymentHash; fail fast if status `failed`; broadcast the hash.
8. `settle` — split across windows (timeout 120 s, poll 3 s, `gatewayFund` 1 block per poll):
   - Buyer window polls its own `getLightningSendRequest(hash)` until `Settled`/`Failed`,
     broadcasting status.
   - Merchant window (keepalive already running) receives the hash, polls its own
     balance delta + `listPaymentsRaw()` for the hash, broadcasts the verdict; both
     windows show the done card on success per §1.
   - ⚠️ Balance check differs from RN: wasm `getAssetBalance` reads only the on-chain
     rgb-lib db and errors "Asset not found" for channel-pushed RGB (the wasm backend
     doesn't register the funding-consignment contract with the wallet db, unlike
     native). Verify via `listChannels` → `assetLocalAmount` delta on the LSP channel
     instead of `offchainOutbound` (same substitution in the §1 success criteria).

Constants mirror RN `config.ts`: `PAYMENT_MSAT=3_000_000`, `PAYMENT_ASSET_AMOUNT=1`,
`CHANNEL_TIMEOUT_S=180`, `SETTLE_TIMEOUT_S=120`, `POLL_INTERVAL_MS=3_000`,
`MERCHANT_KEEPALIVE_MS=15_000`, `APAY_HASH_REFILL_THRESHOLD=3`, `CART_ITEM='1× RGB Token (UTST)'`.

---

## 3. Window strategy — two windows (decided)

Same page in two windows, role selector like `RegtestLspFlow` — **Run 1: Merchant
window, Run 2: Buyer window**:

1. **Window 1 — "Run Merchant"**: merchant half of §2, ends showing the Lightning
   Address card, then *stays running* (keepalive + refill + settle watcher).
2. **Window 2 — "Run Buyer"**: Run enabled once the Lightning Address arrives over
   BroadcastChannel (or pasted manually, like the invoice field in `RegtestLspFlow`);
   runs the buyer half.

BroadcastChannel `utexo-apay-flow` messages:
- merchant → buyer: `{type:'lnaddress', address}` (re-broadcast periodically so a
  late-opened buyer window catches it), `{type:'merchant_status', phase, balance}`
- buyer → merchant: `{type:'payment', paymentHash, status}`

Each window shows the other role's status in an info card; both display the final
"Cart Checkout Complete" card. Gates per window: reuse `clearWalletsAndReload()` +
the `hasOtherWallet` warning. UI copy must state the merchant window has to stay open
during the buyer run.

---

## 4. Files

```
rgb-sdk-web-demo/src/
  components/apay/
    config.ts            # phases, labels, constants, env parsing (import.meta.env)
    useApayFlow.ts       # orchestration per §2 — takes {role: 'merchant'|'buyer'};
                         # one wallet in a ref; BroadcastChannel wiring; abort flag; log state
    PhaseRow.tsx         # phase stepper (active role's phases; RN PHASES_P1/P2 split by role)
    InfoCard.tsx         # LN address / channel / HODL invoice / payment / balance cards
    LogPane.tsx          # timestamped → req / ← res console (tail 500)
    ApayCartCheckout.tsx # guided UI: env badge, cart card, role Run buttons, done card
  pages/LspApayPage.tsx  # RegtestLspFlow stays on top AS-IS (user decision 2026-07-03:
                         # keep the proven flow); ApayCartCheckout inserted right below
                         # it; existing API sections 1–5 remain at the bottom unchanged
  pages/HomePage.tsx     # card copy → “APay Cart Checkout — guided merchant+buyer flow”
```

Conventions: `Section`/`Field`/`Btn`/`OutputBox` + Tailwind palette from the existing
pages; `useStore` only for the global activity log; TypeScript strict; verify with
`npm run build`.

Env (all already written by `start-lsp-web.sh`): `VITE_LSP_REGTEST_ASSET_ID`,
`VITE_LSP_REGTEST_PEER_PUBKEY`, `VITE_LSP_REGTEST_LDK_PORT`, `VITE_LSP_BASE_URL`,
`VITE_RLN_GATEWAY_WS/HTTP`, `VITE_RLN_TRANSPORT`, `VITE_RLN_INDEXER`,
`VITE_FAUCET_RLN_VIA_GATEWAY`. Env badge green iff assetId + lspPubkey present.

---

## 5. Order of work

0. ✅ **DONE + VERIFIED (2026-07-02)** — wasm accept fix landed; full two-window run
   green: channel usable → `lightning_receive` top-up settled → 1-RGB payment
   **Settled** end-to-end in the browser. Getting there required a chain of companion
   fixes, all landed:
   - `rgb-lightning-node/bindings/wasm-sdk`: inbound accept (OpenChannelRequest port),
     channel-view enrichment (asset + balance msat), `is_expired` wasm time-panic fix.
   - `rgb-sdk-web`: switch to the **live** wasm APIs (`createLnInvoiceLiveJson`,
     `sendPaymentLiveJson`, `keysendLiveJson`, live-ledger status reads + casing folds)
     — the scaffold APIs simulate and never touch the wire (see
     `rgb-sdk-web/WASM_LIVE_INVOICE_STATUS_GAP.md`); drive beat on all polling reads
     (`chainSyncTickValue` + `driveRgbFundingWork`) — no background executor in wasm;
     dormant chain-sync session started on LN attach (stale height → LSP rejects HTLCs
     with expiry_too_soon).
   - `rgb-sdk-web-demo`: `RegtestLspFlow` sender got the RN-style `a_topup`
     (receiveAsset → faucet via gateway proxy → settlement waits, matching transfers
     by recipient_id, mining through every wait) + sender settle-poll;
     `start-lsp-web.sh` BSD-grep env-cleanup fix (stale asset ids accumulated).
   Operational rule: **restart the Vite dev server after every stack restart** (fresh
   asset id in `.env.local`).
1. ✅ Effectively covered by step 0's top-up leg (`receiveAsset` round trip). Still
   optionally smoke `enableLightningAddress` via the `/lsp-apay` API section before
   wiring it into the hook.
2. ✅ **DONE (2026-07-03)** — `src/components/apay/config.ts` + `useApayFlow.ts`
   (role-split: merchant = setup → register → keepalive/watch loop; buyer = setup →
   a_topup → waitForOutboundLiquidity (own miner beat — the SDK method has no
   onEachPoll) → payAddress → settle poll). Balance verification via `listChannels`
   `assetLocalAmount` delta per §2; verdict broadcast incl. the soft-fail path.
3. ✅ **DONE (2026-07-03)** — `PhaseRow.tsx`, `InfoCard.tsx`, `LogPane.tsx`,
   `ApayCartCheckout.tsx`.
4. ✅ **DONE (2026-07-03)** — `ApayCartCheckout` inserted below `RegtestLspFlow` in
   `LspApayPage.tsx` (current flow preserved as-is); HomePage card copy updated.
   `npm run build` green.
   **← NEXT SESSION STARTS HERE (step 5).**
5. Full manual two-window run against `./scripts/start-lsp-web.sh` (restart Vite
   after stack restart). First-ever exercise of `enableLightningAddress` /
   `payAddress` in wasm — expect iteration here (custom-msg 37915 over gateway WS).

## 6. Risks / open questions

- **Item 0 depth** — the documented fix (2 config lines + event handler) may not be
  sufficient: inbound virtual channels likely also need wasm virtual-session
  bookkeeping (today wired only on the outbound open path). Budget for iteration;
  the RegtestLspFlow acceptance gate catches this early.
- **HTLC routing over an accepted virtual channel in wasm** — accept is the handshake;
  payments over the channel (buyer pays HODL invoice with RGB) exercise more paths.
  Step-1 smoke + the buyer `a_topup` are the early detectors.
- **Cross-window timing** — merchant window must stay open/connected during the buyer
  run; buyer Run stays disabled until the Lightning Address arrives (manual paste as
  escape hatch).
- **`PaymentHashAlreadyUsed`** on the LSP's final forward — soft-fail with a clear log
  line ("merchant will receive via LSP outbox") instead of a red error, per mission.
- **Misleading SDK comment** — `RlnWasmBinding.ts:406-410` claims
  `setEnableVirtualChannelsV0` fixes inbound accept; correct it when item 0 lands so
  the next reader isn't misled.

## 7. Out of scope

- Signet/production APay, external signer/VLS, Puppeteer harness.
- Browser-opened real-channel fallback path (only if item 0 stalls; see §0).
- Any `start-lsp-web.sh` / Vite config changes.
