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
