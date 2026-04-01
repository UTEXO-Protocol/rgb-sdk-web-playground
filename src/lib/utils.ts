import { DEFAULT_TRANSPORT_ENDPOINTS, DEFAULT_INDEXER_URLS } from '@utexo/rgb-sdk-web';

export const json = (obj: unknown): string =>
  JSON.stringify(obj, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2);

// Regtest infrastructure URLs (override via .env VITE_REGTEST_* variables)
export const REGTEST_INDEXER_URL: string =
  (import.meta.env.VITE_REGTEST_INDEXER_URL as string) ?? 'http://localhost:8094/regtest/api';
export const REGTEST_PROXY_HTTP_URL: string =
  (import.meta.env.VITE_REGTEST_PROXY_HTTP_URL as string) ?? 'http://localhost:3000/json-rpc';
export const REGTEST_PROXY_RPC_URL: string =
  (import.meta.env.VITE_REGTEST_PROXY_RPC_URL as string) ?? 'rpc://localhost:3000/json-rpc';

/** Rewrite remote esplora URLs through the Vite dev-server proxy to avoid CORS. */
export function proxyIndexerUrl(url: string): string {
  return url.replace('https://esplora-api.utexo.com', window.location.origin + '/utexo-api');
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

export const FAUCET_BASE_URL =
  'https://node-api.thunderstack.org/c17bc5d0-80b1-7050-5af5-dfd8a67834f1/1e0cfe422f0e4306bebdab953a0b99f2';

export const FAUCET_TOKEN =
  'EnYKDBgDIggKBggGEgIYDRIkCAASIGuYoof1WC0FaPciGHzPinGmglHd_b3Lb-gokogoeL-aGkA_hc_eLZ05C1XaA9wrcqFh1Bozvi_sawa_QKNCcowZCsVRmrsxJYahtsMduWYGrOVT7JNVVvpcU4PrGu19GrYNIiIKIO5ajD4HcB-R-yadJQCA954KhC7DV2wHi4_piv9k1uYT';


// Routed through Vite dev-server proxy (/bitcoind → localhost:18443) to avoid CORS.
// Override with VITE_REGTEST_BITCOIND_URL if needed (e.g. in production builds).
const REGTEST_BITCOIND_URL: string =
  (import.meta.env.VITE_REGTEST_BITCOIND_URL as string) ?? '/bitcoind/wallet/miner';
const REGTEST_BITCOIND_USER: string =
  (import.meta.env.VITE_REGTEST_BITCOIND_USER as string) ?? 'user';
const REGTEST_BITCOIND_PASS: string =
  (import.meta.env.VITE_REGTEST_BITCOIND_PASS as string) ?? 'password';

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
