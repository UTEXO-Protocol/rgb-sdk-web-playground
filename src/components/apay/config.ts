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
