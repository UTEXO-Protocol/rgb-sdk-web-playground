import React, { useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { initWasm } from '@utexo/rgb-sdk-web';
import { Layout } from './components/Layout';
import { useStore } from './store';
import { autoRestore, getSavedActiveWalletId, setUrlWallet } from './lib/session';
import { HomePage } from './pages/HomePage';
import { KeysPage } from './pages/KeysPage';
import { WalletPage } from './pages/WalletPage';
import { BitcoinPage } from './pages/BitcoinPage';
import { RgbAssetsPage } from './pages/RgbAssetsPage';
import { WalletManagerBackupPage } from './pages/WalletManagerBackupPage';
import { UtexoBackupPage } from './pages/UtexoBackupPage';
import { UtexoWalletPage } from './pages/UtexoWalletPage';

function App() {
  const setSdkStatus = useStore((s) => s.setSdkStatus);
  const addLog = useStore((s) => s.addLog);
  const setWallets = useStore((s) => s.setWallets);
  const didInit = useRef(false);

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    setSdkStatus('loading');
    initWasm()
      .then(async () => {
        setSdkStatus('ready');
        addLog('SDK initialized', 'ok');
        const { wallets: restored, errors } = await autoRestore();
        if (restored.length > 0) {
          // URL param > sessionStorage > last wallet
          const urlId = new URLSearchParams(window.location.search).get('wallet');
          const savedId = getSavedActiveWalletId();
          const activeId =
            (urlId && restored.find((w) => w.id === urlId))
              ? urlId
              : (savedId && restored.find((w) => w.id === savedId))
              ? savedId
              : (restored[restored.length - 1]?.id ?? null);
          setWallets(restored, activeId);
          if (activeId) setUrlWallet(activeId);
          addLog(restored.length + ' wallet(s) restored from session', 'ok');
        }
        for (const { label, error } of errors) {
          const isRemoved = error.includes('missing network type');
          const isNetworkConflict = error.includes('Bitcoin network mismatch');
          addLog(
            'Restore failed — "' + label + '": ' + error +
            (isRemoved ? ' (entry removed — recreate the wallet)' : '') +
            (isNetworkConflict ? ' — IDB conflict: another wallet with the same mnemonic but a different network wrote to the same IndexedDB key. Use a different mnemonic, or clear IndexedDB in DevTools → Application → IndexedDB.' : ''),
            'err',
          );
        }
      })
      .catch((e) => {
        setSdkStatus('error', String(e));
        addLog('SDK init failed: ' + e, 'err');
      });
  }, []);

  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/keys" element={<KeysPage />} />
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="/bitcoin" element={<BitcoinPage />} />
          <Route path="/rgb-assets" element={<RgbAssetsPage />} />
          <Route path="/backup/manager" element={<WalletManagerBackupPage />} />
          <Route path="/backup/utexo" element={<UtexoBackupPage />} />
          <Route path="/utexo-wallet" element={<UtexoWalletPage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
