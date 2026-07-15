// APay · UTEXO (signet) config — web port of rgb-sdk-rn-demo/screens/apay-signet.
//
// Same APay flow as the regtest variant, but against the live signet stack:
//   - wallet.network = 'utexo' (proxy/transport/indexer default from the SDK)
//   - no manual mining — fund/UTXO/settlement are reached by waiting for
//     signet confirmations (poll loops with long timeouts)
//   - the faucet RLN node funds BTC and plays the external RGB sender,
//     reached via the /faucet-signet Vite proxy (target from
//     VITE_SIGNET_FAUCET_URL — the browser can't call it cross-origin)
//   - the LSP HTTP API goes through the /lsp-signet proxy for the same reason

const env = import.meta.env as Record<string, string | undefined>;

export const SIG = {
  // Live signet asset (matches the RN demo's EXPO_PUBLIC_SIGNET_ASSET_ID) —
  // override per deploy via VITE_SIGNET_ASSET_ID.
  assetId:
    env.VITE_SIGNET_ASSET_ID ?? 'rgb:YKIEjkhU-iqVFK0y-bfDUio6-bukqH7o-dxjctKB-5TuQ7aM',
  // Same-origin path proxied to https://lsp-signet.utexo.com (vite.config.ts).
  lspBaseUrl: env.VITE_SIGNET_LSP_URL ?? '/lsp-signet',
  // APay-route bearer, if the LSP requires one (the RN demo runs without).
  lspBearerToken: env.VITE_SIGNET_LSP_BEARER ?? '',
  // WS gateway the wasm node dials LDK peers through — unlike RN (native TCP),
  // the browser needs this relay. Unset → the SDK's utexo default.
  proxyUrl: env.VITE_SIGNET_PROXY_WS?.trim() || undefined,
  // Optional overrides for the SDK's utexo defaults.
  indexerUrl: env.VITE_SIGNET_INDEXER_URL?.trim() || undefined,
  transportEndpoint: env.VITE_SIGNET_TRANSPORT?.trim() || undefined,
};

// Client-side readiness marker: the proxy target lives in vite.config.ts, but
// the same VITE_ var is exposed here so the UI can tell whether it was set.
export const FAUCET_CONFIGURED = !!env.VITE_SIGNET_FAUCET_URL?.trim();
export const FAUCET_API = '/faucet-signet';

export const BC_NAME_SIGNET = 'utexo-apay-signet-flow';

export const CART_ITEM_SIGNET = '1× RGB Token (signet)';
export const PAYMENT_MSAT = 3_000_000;
export const PAYMENT_ASSET_AMOUNT = 1;

// BTC the faucet sends to each wallet, plus the colorable UTXO count.
// createUtxos uses the node default of 32_000 sat/UTXO (needed so the
// colorable UTXOs are large enough to back LSP channel opens):
//   colorable = 5 × 32_000 = 160_000 sat  →  fund ≥ 250_000 sat
export const FAUCET_BTC_SAT = 250_000;
export const UTXO_NUM = 5;
export const FEE_RATE = 2;

// Signet: no mining — blocks arrive naturally, everything just takes longer.
export const POLL_MS = 15_000;
export const CHANNEL_TIMEOUT_MS = 30 * 60 * 1000; // channel needs 6 confs
export const FUND_TIMEOUT_MS = 15 * 60 * 1000;
export const SETTLE_TIMEOUT_MS = 30 * 60 * 1000;
export const MERCHANT_KEEPALIVE_MS = 15_000;
export const LNADDRESS_REBROADCAST_MS = 5_000;
/** Auto-refill the merchant's APay hash pool below this many unused hashes. */
export const APAY_HASH_REFILL_THRESHOLD = 3;

// ── Faucet RLN-node REST helpers (NOT the SDK) — RN demo daemons.ts port ─────

async function faucetPost<T = unknown>(path: string, body: object = {}): Promise<T> {
  const r = await fetch(`${FAUCET_API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`faucet ${path} → ${r.status}: ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

export const faucet = {
  sendBtc: (address: string, amount: number, feeRate: number) =>
    faucetPost('/sendbtc', { address, amount, fee_rate: feeRate, skip_sync: false }),
  assetBalance: (assetId: string) =>
    faucetPost<{ spendable?: number }>('/assetbalance', { asset_id: assetId }),
  decodeRgbInvoice: (invoice: string) =>
    faucetPost<{
      recipient_id: string;
      transport_endpoints?: string[];
      assignment?: { type: string; value: number };
    }>('/decodergbinvoice', { invoice }),
  sendRgb: (body: object) => faucetPost('/sendrgb', body),
  listTransfers: (assetId: string) =>
    faucetPost<{
      transfers?: { kind?: string; status?: string; recipient_id?: string }[];
    }>('/listtransfers', { asset_id: assetId }),
  // rgb-lib needs a double refresh to advance both legs of a transfer.
  refresh: async () => {
    await faucetPost('/refreshtransfers', { filter: [], skip_sync: false });
    await faucetPost('/refreshtransfers', { filter: [], skip_sync: false });
  },
};
