import { deriveKeysFromMnemonic, WalletManager, UTEXOWallet } from '@utexo/rgb-sdk-web';
import { proxyIndexerUrl } from './utils';
import type { WalletInstance, WalletConfig } from '../store';

const SESSION_KEY = 'rgb_wallet_sessions';  // localStorage — shared across tabs
const ACTIVE_KEY = 'rgb_active_wallet_id';  // sessionStorage — per-tab

interface SessionEntry {
  id: string;
  label: string;
  type: 'manager' | 'utexo';
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

  if (type === 'manager') {
    const keys = await deriveKeysFromMnemonic(config.network, config.mnemonic);
    const m = await WalletManager.create({
      mnemonic: config.mnemonic,
      xpubVan: keys.accountXpubVanilla,
      xpubCol: keys.accountXpubColored,
      masterFingerprint: keys.masterFingerprint,
      network: config.network,
      indexerUrl: config.indexerUrl ? proxyIndexerUrl(config.indexerUrl) : undefined,
      transportEndpoint: config.transportEndpoint || undefined,
    });
    if (config.indexerUrl) {
      try { await m.goOnline(proxyIndexerUrl(config.indexerUrl)); } catch {}
    }
    return {
      id: entry.id,
      label: entry.label,
      type: 'manager',
      config,
      instance: m,
      online: !!config.indexerUrl,
    };
  }

  if (type === 'utexo') {
    const preset =
      config.network === 'mainnet' || config.network === 'testnet'
        ? config.network
        : 'testnet';
    const w = new UTEXOWallet(config.mnemonic, { network: preset as 'mainnet' | 'testnet' });
    await w.initialize();
    if (config.indexerUrl) {
      try { await w.goOnline(proxyIndexerUrl(config.indexerUrl)); } catch {}
    }
    return {
      id: entry.id,
      label: entry.label,
      type: 'utexo',
      config,
      instance: w,
      online: !!config.indexerUrl,
    };
  }

  return null;
}
