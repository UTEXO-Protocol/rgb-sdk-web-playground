// APay Cart Checkout — web port of rgb-sdk-rn-demo/screens/apay/config.ts.
// Phase names and the `→ req` / `← res` log format match RN for cross-demo
// debugging. Env comes from .env.local (written by scripts/start-lsp-web.sh).

const env = import.meta.env as Record<string, string | undefined>;

export const CFG = {
  assetId: env.VITE_LSP_REGTEST_ASSET_ID ?? '',
  lspPubkey: env.VITE_LSP_REGTEST_PEER_PUBKEY ?? '',
  lspPort: Number(env.VITE_LSP_REGTEST_LDK_PORT ?? 9745),
  lspBaseUrl: env.VITE_LSP_BASE_URL ?? '/lsp',
  gatewayWs: env.VITE_RLN_GATEWAY_WS ?? 'ws://127.0.0.1:3001',
  transport: env.VITE_RLN_TRANSPORT ?? 'http://127.0.0.1:3001/rgb/json-rpc',
  indexer: env.VITE_RLN_INDEXER ?? 'http://127.0.0.1:3002',
  gatewayHttp: env.VITE_RLN_GATEWAY_HTTP ?? 'http://127.0.0.1:3001',
};

// Faucet RLN REST via the gateway proxy (start-lsp-web.sh: /dev/regular-rln/* → :3108).
export const FAUCET_API =
  env.VITE_FAUCET_RLN_VIA_GATEWAY ?? `${CFG.gatewayHttp}/dev/regular-rln`;

// Faucet RLN LDK peer port — the wasm node dials it through the gateway ws relay.
export const FAUCET_LDK_PORT = Number(env.VITE_FAUCET_LDK_PORT ?? 9748);

// ── regular_web: the third daemon, started WITHOUT --enable-virtual-channels-v0
// (start-lsp-web.sh, VIRTUAL_CHANNELS=0). A node with that flag rejects a
// wasm-initiated open with `unsupported_scid_alias`, so this is the only peer
// the browser can open a channel *to* (MIGRATION-PLAN-v3 §6.0r/§6.0s).
// No REST base here on purpose: the gateway proxies only the faucet's API
// (/dev/regular-rln → :3108). Readiness is read from the wasm side via
// listChannels, so the pubkey and the peer port are all this flow needs.
export const REGULAR_PUBKEY = env.VITE_REGULAR_PEER_PUBKEY ?? '';
export const REGULAR_LDK_PORT = Number(env.VITE_REGULAR_LDK_PORT ?? 9750);

/** Same-origin esplora (vite proxy → CFG.indexer); esplora sends no CORS headers. */
export const INDEXER_PROXY = '/indexer';

export const BC_NAME = 'utexo-apay-flow';

export const CART_ITEM = '1× RGB Token (UTST)';
export const PAYMENT_MSAT = 3_000_000;
export const PAYMENT_ASSET_AMOUNT = 1;
export const CHANNEL_TIMEOUT_S = 180;
export const SETTLE_TIMEOUT_S = 120;
export const POLL_INTERVAL_MS = 3_000;
export const MERCHANT_KEEPALIVE_MS = 15_000;
/** Auto-refill the merchant's APay hash pool once it drops below this many unused hashes. */
export const APAY_HASH_REFILL_THRESHOLD = 3;
/** Merchant re-broadcasts its Lightning Address so a late-opened buyer window catches it. */
export const LNADDRESS_REBROADCAST_MS = 5_000;

// Regular (non-virtual) hub → wasm channel test (RegularChannelFlow):
// the Faucet RLN opens an on-chain-funded RGB channel to the wasm node,
// pushing half the asset so both sides can pay from the start.
export const REGULAR_CHANNEL_CAPACITY_SAT = 100_000;
// Must comfortably exceed REGULAR_PAY_MSAT + the 1% LDK channel reserve
// (1000 sat on 100k) — 3.5M msat left only ~2.5M spendable → RouteNotFound.
export const REGULAR_CHANNEL_PUSH_MSAT = 10_000_000;
export const REGULAR_CHANNEL_ASSET_AMOUNT = 200;
export const REGULAR_CHANNEL_PUSH_ASSET_AMOUNT = 100;
export const REGULAR_PAY_ASSET_AMOUNT = 10;
// Payback is intentionally smaller than the pay leg, so the post-close on-chain
// balances show a real difference (wasm 100−10+5=95, hub 100+10−5=105) instead
// of netting back to the pushed amounts.
export const REGULAR_PAYBACK_ASSET_AMOUNT = 5;
export const REGULAR_PAY_MSAT = 3_000_000;
/** Hub-initiated keysend repro (channel_issue.md) — asset amount matches the report. */
export const KEYSEND_REPRO_ASSET_AMOUNT = 30;

// ── Wallet-funded open repro (§6.0s) ────────────────────────────────────────
// Matches tests/e2e/i-funding.spec.ts in rgb-sdk-web so a demo run and a spec
// run are comparable. BTC-only: the asset leg is irrelevant to whether the
// funding tx reaches the mempool, and leaving it out removes a variable.
export const FUNDING_CAPACITY_SAT = 100_000;
export const FUNDING_FEE_RATE = 2;
/** How long to wait for the funding tx to appear in the indexer before probing. */
export const FUNDING_BROADCAST_TIMEOUT_S = 60;
/** How long to wait for channel_ready once the tx is in the mempool. */
export const FUNDING_READY_TIMEOUT_S = 300;

export type Role = 'merchant' | 'buyer';

export type Phase =
  | 'idle'
  | 'b_init'
  | 'b_fund'
  | 'b_utxos'
  | 'b_channel'
  | 'register'
  | 'watch'
  | 'a_init'
  | 'a_fund'
  | 'a_utxos'
  | 'a_channel'
  | 'a_topup'
  | 'send'
  | 'settle'
  | 'rc_init'
  | 'rc_fund'
  | 'rc_utxos'
  | 'rc_connect'
  | 'rc_channel'
  | 'rc_pay'
  | 'rc_payback'
  | 'rc_keysend'
  | 'rc_funding'
  | 'done'
  | 'error';

export const PHASE_LABELS: Record<Phase, string> = {
  idle: 'Idle',
  b_init: 'Init',
  b_fund: 'Fund',
  b_utxos: 'UTXOs',
  b_channel: 'Channel',
  register: 'Register',
  watch: 'Watch',
  a_init: 'Init',
  a_fund: 'Fund',
  a_utxos: 'UTXOs',
  a_channel: 'Channel',
  a_topup: 'Top-up',
  send: 'Pay',
  settle: 'Settle',
  rc_init: 'Init',
  rc_fund: 'Fund',
  rc_utxos: 'UTXOs',
  rc_connect: 'Connect',
  rc_channel: 'Channel',
  rc_pay: 'Pay →hub',
  rc_payback: 'Pay ←hub',
  rc_keysend: 'Keysend',
  rc_funding: 'Wallet-funded open',
  done: 'Done',
  error: 'Error',
};

export const PHASES_MERCHANT: Phase[] = [
  'b_init',
  'b_fund',
  'b_utxos',
  'b_channel',
  'register',
  'watch',
  'done',
];
export const PHASES_BUYER: Phase[] = [
  'a_init',
  'a_fund',
  'a_utxos',
  'a_channel',
  'a_topup',
  'send',
  'settle',
  'done',
];
export const PHASES_REGULAR: Phase[] = [
  'rc_init',
  'rc_fund',
  'rc_utxos',
  'rc_connect',
  'rc_channel',
  'rc_pay',
  'rc_payback',
  'done',
];
/** Faithful channel_issue.md repro: hub keysend as the FIRST HTLC on a fresh channel. */
export const PHASES_KEYSEND_REPRO: Phase[] = [
  'rc_init',
  'rc_fund',
  'rc_utxos',
  'rc_connect',
  'rc_channel',
  'rc_keysend',
  'done',
];

export interface LogEntry {
  time: string;
  msg: string;
  type: 'info' | 'success' | 'error';
}

/** Cross-window coordination over BroadcastChannel (plan §3). */
export type ApayBcMessage =
  | { type: 'lnaddress'; address: string }
  | { type: 'merchant_status'; phase: Phase; localRgb?: number }
  | { type: 'payment'; paymentHash: string; status: string }
  | { type: 'verdict'; ok: boolean; soft?: boolean; detail: string };

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const short = (s: string, n = 24) =>
  (s || '').slice(0, n) + ((s || '').length > n ? '…' : '');
export const normHash = (h: string) => (h || '').toLowerCase().replace(/^0x/, '');

/**
 * Has the indexer actually seen this transaction?
 *
 * Must be `GET /tx/<txid>`, which 404s on an unknown txid. Do NOT use
 * `/tx/<txid>/status` for presence: esplora answers that one with
 * **HTTP 200 `{"confirmed":false}`** for a txid that has never existed, so an
 * `r.ok` test there reports every transaction as broadcast — including one that
 * was never published at all.
 */
export async function indexerTxSeen(
  txid: string
): Promise<{ confirmed: boolean } | null> {
  const r = await fetch(`${INDEXER_PROXY}/tx/${txid}`);
  if (!r.ok) return null; // 404 — never seen, not even in the mempool
  const tx = (await r.json().catch(() => null)) as {
    status?: { confirmed?: boolean };
  } | null;
  return { confirmed: !!tx?.status?.confirmed };
}

/**
 * Push a raw tx straight to esplora, bypassing the SDK entirely.
 *
 * This is the bisect for §6.0s: if esplora accepts the same hex the SDK failed
 * to broadcast, the transaction is valid and only our broadcast path is broken;
 * if esplora rejects it, the transaction itself is wrong (stale-view input
 * selection — the §6.0l race) and the broadcast path is innocent.
 */
export async function indexerBroadcast(
  txHex: string
): Promise<{ accepted: boolean; body: string }> {
  const r = await fetch(`${INDEXER_PROXY}/tx`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: txHex,
  });
  return { accepted: r.ok, body: (await r.text().catch(() => '')).trim() };
}

export async function gatewayFund(
  address: string,
  amountBtc: number,
  mineBlocks: number
) {
  const r = await fetch(`${CFG.gatewayHttp}/dev/regtest/fund`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      address,
      amount_btc: amountBtc,
      mine_blocks: mineBlocks,
    }),
  });
  if (!r.ok) throw new Error(`gateway /dev/regtest/fund → ${r.status}`);
}

export async function faucetGet<T = unknown>(path: string): Promise<T> {
  const r = await fetch(`${FAUCET_API}${path}`);
  if (!r.ok) {
    throw new Error(`faucet ${path} → ${r.status}: ${await r.text().catch(() => '')}`);
  }
  return (await r.json().catch(() => ({}))) as T;
}

export async function faucetPost<T = unknown>(
  path: string,
  body: unknown
): Promise<T> {
  const r = await fetch(`${FAUCET_API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    throw new Error(`faucet ${path} → ${r.status}: ${await r.text().catch(() => '')}`);
  }
  return (await r.json().catch(() => ({}))) as T;
}
