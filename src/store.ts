import { create } from 'zustand';
import type { WalletManager, UTEXOWallet } from '@utexo/rgb-sdk-web';
import { wrapWallet } from './lib/wrapWallet';

type LogLevel = 'ok' | 'err' | 'warn' | 'info';

export interface SdkLogEntry {
  id: string;
  ts: string;
  method: string;
  args: unknown[];
  result?: unknown;
  error?: string;
  durationMs: number;
  status: 'ok' | 'error';
}

interface LogEntry {
  ts: string;
  msg: string;
  level: LogLevel;
}

export interface WalletConfig {
  network: string;
  indexerUrl: string;
  transportEndpoint: string;
  masterFingerprint: string;
  xpubVan: string;
  xpubCol: string;
  mnemonic: string;
  reuseAddresses?: boolean;
}

export interface WalletInstance {
  id: string;
  label: string;
  type: 'manager' | 'utexo';
  config: WalletConfig;
  instance: WalletManager | UTEXOWallet;
  online: boolean;
}

interface Store {
  sdkStatus: 'idle' | 'loading' | 'ready' | 'error';
  sdkError: string | null;

  wallets: WalletInstance[];
  activeWalletId: string | null;

  log: LogEntry[];
  sdkLog: SdkLogEntry[];

  setSdkStatus: (s: Store['sdkStatus'], err?: string) => void;
  addWallet: (w: WalletInstance) => void;
  setWallets: (wallets: WalletInstance[], activeWalletId: string | null) => void;
  removeWallet: (id: string) => void;
  setActiveWalletId: (id: string | null) => void;
  updateWallet: (id: string, patch: Partial<Pick<WalletInstance, 'label' | 'online'>>) => void;
  addLog: (msg: string, level?: LogLevel) => void;
  clearLog: () => void;
  addSdkLog: (entry: SdkLogEntry) => void;
  clearSdkLog: () => void;
}

export const useStore = create<Store>((set, get) => ({
  sdkStatus: 'idle',
  sdkError: null,
  wallets: [],
  activeWalletId: null,
  log: [],
  sdkLog: [],

  setSdkStatus: (sdkStatus, err) =>
    set({ sdkStatus, sdkError: err ?? null }),

  addWallet: (w) => {
    const wrapped = { ...w, instance: wrapWallet(w.instance, get().addSdkLog) };
    set((s) => ({ wallets: [...s.wallets, wrapped], activeWalletId: w.id }));
  },

  setWallets: (wallets, activeWalletId) => {
    const addSdkLog = get().addSdkLog;
    const wrapped = wallets.map((w) => ({ ...w, instance: wrapWallet(w.instance, addSdkLog) }));
    set({ wallets: wrapped, activeWalletId });
  },

  removeWallet: (id) =>
    set((s) => {
      const wallets = s.wallets.filter((w) => w.id !== id);
      const activeWalletId =
        s.activeWalletId === id
          ? (wallets[wallets.length - 1]?.id ?? null)
          : s.activeWalletId;
      return { wallets, activeWalletId };
    }),

  setActiveWalletId: (activeWalletId) => set({ activeWalletId }),

  updateWallet: (id, patch) =>
    set((s) => ({
      wallets: s.wallets.map((w) => (w.id === id ? { ...w, ...patch } : w)),
    })),

  addLog: (msg, level = 'info') =>
    set((s) => ({
      log: [...s.log, { ts: new Date().toLocaleTimeString(), msg, level }],
    })),

  clearLog: () => set({ log: [] }),

  addSdkLog: (entry) =>
    set((s) => ({ sdkLog: [...s.sdkLog, entry] })),

  clearSdkLog: () => set({ sdkLog: [] }),
}));
