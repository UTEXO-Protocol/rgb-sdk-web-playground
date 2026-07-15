import { UTEXOWallet, RlnWalletManager, initRlnWasm } from '@utexo/rgb-sdk-web';
import { proxyIndexerUrl, DEMO_VSS_URL, resolveVssUrl } from './utils';
import type { WalletInstance, WalletConfig } from '../store';

const SESSION_KEY = 'rgb_wallet_sessions';  // localStorage — shared across tabs
const ACTIVE_KEY = 'rgb_active_wallet_id';  // sessionStorage — per-tab

interface SessionEntry {
  id: string;
  label: string;
  type: 'utexo' | 'rln';
  config: WalletConfig;
}

export function saveSessions(wallets: WalletInstance[], activeWalletId: string | null): void {
  const entries: SessionEntry[] = wallets.map((w) => ({
    id: w.id,
    label: w.label,
    type: w.type,
    config: w.config,
  }));
  localStorage.setItem(SESSION_KEY, JSON.stringify(entries));
  if (activeWalletId) {
    sessionStorage.setItem(ACTIVE_KEY, activeWalletId);
  } else {
    sessionStorage.removeItem(ACTIVE_KEY);
  }
}

export function clearSessions(): void {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(ACTIVE_KEY);
}

export function removeSessionEntry(id: string): void {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const entries = JSON.parse(raw) as SessionEntry[];
    const filtered = entries.filter((e) => e.id !== id);
    localStorage.setItem(SESSION_KEY, JSON.stringify(filtered));
  } catch {}
}

export function getSavedActiveWalletId(): string | null {
  return sessionStorage.getItem(ACTIVE_KEY);
}

export function setUrlWallet(id: string | null): void {
  const url = new URL(window.location.href);
  if (id) {
    url.searchParams.set('wallet', id);
  } else {
    url.searchParams.delete('wallet');
  }
  history.replaceState(null, '', url.toString());
}

export type RestoreResult = {
  wallets: WalletInstance[];
  errors: Array<{ id: string; label: string; error: string }>;
};

export async function autoRestore(): Promise<RestoreResult> {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return { wallets: [], errors: [] };  // nothing saved yet
    const entries = JSON.parse(raw) as SessionEntry[];
    const wallets: WalletInstance[] = [];
    const errors: Array<{ id: string; label: string; error: string }> = [];
    for (const entry of entries) {
      try {
        const instance = await restoreEntry(entry);
        if (instance) wallets.push(instance);
      } catch (e) {
        console.error('Failed to restore wallet', entry.label, e);
        errors.push({ id: entry.id, label: entry.label, error: String(e) });
        // Only auto-remove entries with a truly unrecoverable WASM build error
        // (missing WASM network type means the binary doesn't support that network).
        // "Bitcoin network mismatch" and other IDB data conflicts are NOT removed —
        // they mean two wallets with the same mnemonic but different networks are
        // sharing the same IndexedDB key. The user must use different mnemonics,
        // or clear IndexedDB manually (DevTools → Application → IndexedDB).
        if (String(e).includes('missing network type')) {
          removeSessionEntry(entry.id);
        }
      }
    }
    return { wallets, errors };
  } catch (e) {
    return { wallets: [], errors: [{ id: '', label: '(session parse)', error: String(e) }] };
  }
}

async function restoreEntry(entry: SessionEntry): Promise<WalletInstance | null> {
  const { type, config } = entry;

  if (type === 'utexo') {
    if (!config.password) {
      console.warn('[UTEXO restore] skipping — no password in config');
      return null; // RLN-backed UTEXOWallet needs the SDK password
    }
    await initRlnWasm();
    // init() auto-connects (non-fatal): indexerUrl falls back to the
    // network default when none was saved.
    const w = new UTEXOWallet({
      mnemonic: config.mnemonic,
      password: config.password,
      network: config.network,
      proxyUrl: config.proxyUrl || undefined,
      transportEndpoint: config.transportEndpoint || undefined,
      nodeRuntimeId: config.nodeRuntimeId || undefined,
      indexerUrl: config.indexerUrl ? proxyIndexerUrl(config.indexerUrl) : undefined,
      // Restore with the same VSS setting the wallet was created with;
      // legacy sessions (no vssUrl key) fall back to the local stack default.
      // resolveVssUrl: saved configs may hold a relative "/vss".
      vssUrl:
        config.vssUrl !== undefined ? resolveVssUrl(config.vssUrl) : DEMO_VSS_URL,
    });
    await w.init();
    await w.unlock();
    if (!w.isOnline()) console.warn('[UTEXO restore] wallet restored OFFLINE (indexer unreachable)');
    return {
      id: entry.id,
      label: entry.label,
      type: 'utexo',
      config,
      instance: w,
      online: w.isOnline(),
    };
  }

  if (type === 'rln') {
    console.log('[RLN restore] entry:', entry.id, entry.label, 'network:', config.network, 'hasPassword:', !!config.password);
    if (!config.password) {
      console.warn('[RLN restore] skipping — no password in config');
      return null; // can't restore without password
    }
    await initRlnWasm();
    console.log('[RLN restore] initRlnWasm ok, calling RlnWalletManager.create...');
    let m: Awaited<ReturnType<typeof RlnWalletManager.create>>;
    try {
      // create() auto-connects (non-fatal): indexerUrl falls back to the
      // network default when none was saved.
      m = await RlnWalletManager.create({
        mnemonic: config.mnemonic,
        password: config.password,
        network: config.network,
        proxyUrl: config.proxyUrl || undefined,
        transportEndpoint: config.transportEndpoint || undefined,
        nodeRuntimeId: config.nodeRuntimeId || undefined,
        indexerUrl: config.indexerUrl ? proxyIndexerUrl(config.indexerUrl) : undefined,
      });
      console.log('[RLN restore] RlnWalletManager.create ok, online:', m.isOnline());
    } catch (e) {
      console.error('[RLN restore] RlnWalletManager.create FAILED:', String(e));
      throw e;
    }
    return {
      id: entry.id,
      label: entry.label,
      type: 'rln',
      config,
      instance: m,
      online: m.isOnline(),
    };
  }

  return null;
}
