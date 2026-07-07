import { DEFAULT_TRANSPORT_ENDPOINTS, DEFAULT_INDEXER_URLS, getRlnUrls } from '@utexo/rgb-sdk-web';

export const json = (obj: unknown): string =>
  JSON.stringify(obj, (_, v) => {
    if (typeof v === 'bigint') return v.toString();
    if (v instanceof Map) return Object.fromEntries(v);
    if (v instanceof Set) return [...v];
    return v;
  }, 2);

// Regtest infrastructure URLs (override via .env VITE_REGTEST_* variables).
// Indexer falls back to VITE_RLN_INDEXER (written by start-lsp-web.sh) and
// then the SDK's per-network default (esplora on 127.0.0.1:3002).
export const REGTEST_INDEXER_URL: string =
  (import.meta.env.VITE_REGTEST_INDEXER_URL as string) ??
  (import.meta.env.VITE_RLN_INDEXER as string) ??
  (DEFAULT_INDEXER_URLS as Record<string, string>).regtest;
export const REGTEST_PROXY_HTTP_URL: string =
  (import.meta.env.VITE_REGTEST_PROXY_HTTP_URL as string) ?? 'http://localhost:3000/json-rpc';
export const REGTEST_PROXY_RPC_URL: string =
  (import.meta.env.VITE_REGTEST_PROXY_RPC_URL as string) ?? 'rpc://localhost:3000/json-rpc';

export function proxyIndexerUrl(url: string): string {
  return url;
}

export function getIndexerUrl(network = 'signet'): string {
  if (network === 'regtest') return REGTEST_INDEXER_URL;
  const url = (DEFAULT_INDEXER_URLS as Record<string, string>)[network]
    ?? (DEFAULT_INDEXER_URLS as Record<string, string>).signet;
  return proxyIndexerUrl(url);
}

export function getTransportEndpoint(network = 'signet'): string {
  if (network === 'regtest') return REGTEST_PROXY_RPC_URL;
  return (DEFAULT_TRANSPORT_ENDPOINTS as Record<string, string>)[network]
    ?? (DEFAULT_TRANSPORT_ENDPOINTS as Record<string, string>).signet;
}

export function getRlnIndexerUrl(network = 'utexo'): string {
  return getRlnUrls(network)?.indexerUrl ?? getIndexerUrl(network);
}

export function getRlnTransportEndpoint(network = 'utexo'): string {
  return getRlnUrls(network)?.transportEndpoint ?? getTransportEndpoint(network);
}

export function getRlnProxyUrl(network = 'utexo'): string {
  return getRlnUrls(network)?.proxyUrl ?? '';
}

export const FAUCET_BASE_URL =
  'https://node-api.thunderstack.org/c17bc5d0-80b1-7050-5af5-dfd8a67834f1/1e0cfe422f0e4306bebdab953a0b99f2';

// UTEXO hosted faucet — a native RLN node REST API (same /sendbtc surface as
// the local Faucet RLN in start-lsp-web.sh).
export const UTEXO_FAUCET_URL: string =
  (import.meta.env.VITE_UTEXO_FAUCET_URL as string) ?? 'https://rln-signet.utexo.com/faucet';

// wasm-proxy-gateway (start-lsp-web.sh) — regtest funding endpoint lives here.
export const RLN_GATEWAY_HTTP: string =
  (import.meta.env.VITE_RLN_GATEWAY_HTTP as string) ?? 'http://127.0.0.1:3001';

/** POST /sendbtc on a faucet RLN node (utexo hosted faucet, thunderstack testnet). */
export async function faucetSendBtc(
  baseUrl: string,
  address: string,
  amountSats: number,
  feeRate: number,
  token?: string
): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const resp = await fetch(baseUrl + '/sendbtc', {
    method: 'POST',
    headers,
    body: JSON.stringify({ address, amount: amountSats, fee_rate: feeRate, skip_sync: false }),
  });
  if (!resp.ok) throw new Error('faucet /sendbtc HTTP ' + resp.status + ': ' + await resp.text());
  return resp.json();
}

/** Regtest funding via the wasm-proxy-gateway (POST /dev/regtest/fund — funds and mines). */
export async function gatewayRegtestFund(
  address: string,
  amountBtc: number,
  mineBlocks = 1
): Promise<void> {
  const resp = await fetch(RLN_GATEWAY_HTTP + '/dev/regtest/fund', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, amount_btc: amountBtc, mine_blocks: mineBlocks }),
  });
  if (!resp.ok)
    throw new Error(
      'gateway /dev/regtest/fund HTTP ' + resp.status + ' — is the LSP web stack running? (' + RLN_GATEWAY_HTTP + ')'
    );
}

export const FAUCET_TOKEN =
  'EnYKDBgDIggKBggGEgIYDRIkCAASIGuYoof1WC0FaPciGHzPinGmglHd_b3Lb-gokogoeL-aGkA_hc_eLZ05C1XaA9wrcqFh1Bozvi_sawa_QKNCcowZCsVRmrsxJYahtsMduWYGrOVT7JNVVvpcU4PrGu19GrYNIiIKIO5ajD4HcB-R-yadJQCA954KhC7DV2wHi4_piv9k1uYT';


// Routed through Vite dev-server proxy (/bitcoind → localhost:18444, the
// compose.wasm.yaml esplora container's bitcoind) to avoid CORS. Credentials
// and wallet match start-lsp-web.sh (admin/passw, wallet bdk-test).
// Override with VITE_REGTEST_BITCOIND_* if needed (e.g. in production builds).
const REGTEST_BITCOIND_URL: string =
  (import.meta.env.VITE_REGTEST_BITCOIND_URL as string) ?? '/bitcoind/wallet/bdk-test';
const REGTEST_BITCOIND_USER: string =
  (import.meta.env.VITE_REGTEST_BITCOIND_USER as string) ?? 'admin';
const REGTEST_BITCOIND_PASS: string =
  (import.meta.env.VITE_REGTEST_BITCOIND_PASS as string) ?? 'passw';

async function bitcoindRpc(method: string, params: unknown[] = []): Promise<unknown> {
  const auth = btoa(REGTEST_BITCOIND_USER + ':' + REGTEST_BITCOIND_PASS);
  const resp = await fetch(REGTEST_BITCOIND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + auth },
    body: JSON.stringify({ jsonrpc: '1.0', id: 'demo', method, params }),
  });
  if (!resp.ok) throw new Error('bitcoind HTTP ' + resp.status + ': ' + await resp.text());
  const result = await resp.json() as { result: unknown; error: { message: string } | null };
  if (result.error) throw new Error('bitcoind ' + method + ': ' + result.error.message);
  return result.result;
}

export async function mineBlocks(blocks = 1): Promise<unknown> {
  const addr = await bitcoindRpc('getnewaddress') as string;
  return bitcoindRpc('generatetoaddress', [blocks, addr]);
}

// Fund an address via bitcoind sendtoaddress (sats → BTC conversion)
export async function fundAddress(address: string, amountSats: number): Promise<string> {
  const btc = amountSats / 1e8;
  return bitcoindRpc('sendtoaddress', [address, btc]) as Promise<string>;
}

export function downloadBytes(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseAmounts(str: string): number[] {
  return str
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number);
}
