import { useStore } from '../store';
import type { WalletInstance } from '../store';

export function useActiveWallet(): WalletInstance | null {
  const wallets = useStore((s) => s.wallets);
  const activeWalletId = useStore((s) => s.activeWalletId);
  return wallets.find((w) => w.id === activeWalletId) ?? null;
}
