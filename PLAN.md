# rgb-sdk-web-demo — Implementation Plan

A React app that demonstrates all `@utexo/rgb-sdk-web` library functions.

---

## Goal

Show every SDK capability in an interactive UI. Not a strict reproduction of the
HTML examples — just a clean React app that lets you call every function and
see the results.

---

## Tech Stack

| Concern | Choice |
|---|---|
| Framework | React 18 + TypeScript |
| Build tool | Vite 6 |
| Routing | React Router v6 (one route per feature group) |
| State | Zustand (holds wallet instances across navigations) |
| Styling | Tailwind CSS v3 (dark theme) |
| WASM | vite-plugin-wasm + vite-plugin-top-level-await |
| Node polyfills | vite-plugin-node-polyfills (Buffer for bitcoinjs-lib) |

---

## Project Structure

```
rgb-sdk-web-demo/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
└── src/
    ├── main.tsx
    ├── App.tsx                  # Router shell + SDK init + global layout
    ├── store.ts                 # Single Zustand store: sdk status, wallet instances, log
    ├── lib/
    │   ├── session.ts           # sessionStorage save/restore (survives page refresh)
    │   └── utils.ts             # json(), getIndexerUrl(), getTransportEndpoint()
    ├── components/
    │   ├── Layout.tsx           # Nav + SDK status badge + activity log drawer
    │   ├── OutputBox.tsx        # <pre> result display with Copy button
    │   ├── StepFlow.tsx         # Reusable Begin → Sign → Broadcast 3-step UI
    │   └── Field.tsx            # Label + input/select wrapper
    └── pages/
        ├── HomePage.tsx         # SDK status, active wallet summary, quick links
        ├── KeysPage.tsx         # generateKeys, restoreKeys, deriveKeysFromMnemonic
        ├── WalletManagerPage.tsx
        ├── UtexoWalletPage.tsx
        ├── BitcoinPage.tsx
        ├── RgbAssetsPage.tsx
        └── BackupPage.tsx
```

---

## Pages & Functions Covered

### HomePage
- SDK init status
- Active wallet summary (type, network)
- Links to each section

### KeysPage — `generateKeys`, `restoreKeys`, `deriveKeysFromMnemonic`, `bip39`
- Generate new mnemonic for selected network
- Restore keys from existing mnemonic
- Derive extended keys from mnemonic (shows xpubs + fingerprint)
- Validate mnemonic with bip39

### WalletManagerPage — `WalletManager`, `createWalletManager`
- Create wallet from keys (xpubs + fingerprint + network)
- Go online (connect to Esplora indexer)
- Get address
- Get BTC balance
- List unspents
- Create UTXOs — 3-step StepFlow (Begin → Sign PSBT → Broadcast) + Auto
- Sync wallet
- Refresh transfers

### UtexoWalletPage — `UTEXOWallet`, `getUtxoNetworkConfig`, `utexoNetworkMap`
- Create + initialize from mnemonic + network preset
- Go online
- Get address
- Get BTC balance
- List assets
- List unspents
- Create UTXOs — 3-step + Auto
- Sync wallet
- Refresh transfers

### BitcoinPage — `sendBtc`, `sendBtcBegin/End`, `signPsbt`, `getFeeEstimation`
- Get address + balance
- Fund via thunderstack.org signet faucet (editable URL + token)
- Fund via local regtest helper
- Send BTC — 3-step StepFlow + Auto
- Sign arbitrary PSBT (paste base64 → sign → show result)
- Fee estimation

### RgbAssetsPage — `issueAssetNia`, `issueAssetIfa`, `createBlindReceive`, `createWitnessReceive`, `sendAssetsBegin/End`, `send`, `listAssets`, `getAsset`
- Wallet selector (WalletManager or UTEXOWallet)
- List all assets
- Get asset by ID
- Issue NIA (non-inflatable fungible)
- Issue IFA (inflatable fungible)
- Create blind receive invoice
- Create witness receive invoice
- Send assets — 3-step StepFlow + Auto
- Refresh transfers

### BackupPage — `createBackup`, `restoreFromBackupBytes`, `restoreUtxoWalletFromBackup`, `restoreUtxoWalletFromVss`, `buildVssConfigFromMnemonic`, `getBackupStoreId`, `DEFAULT_VSS_SERVER_URL`
- WalletManager backup → download bytes as file
- WalletManager restore from file
- UTEXOWallet dual backup → download layer1.bak + utexo.bak
- UTEXOWallet restore from files
- VSS backup (configure + run)
- Restore from VSS (mnemonic + server URL)

---

## package.json

```json
{
  "name": "rgb-sdk-web-demo",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@utexo/rgb-sdk-web": "file:../rgb-sdk-web",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.26.0",
    "zustand": "^4.5.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.5.0",
    "vite": "^6.0.0",
    "vite-plugin-node-polyfills": "^0.25.0",
    "vite-plugin-top-level-await": "^1.4.4",
    "vite-plugin-wasm": "^3.3.0"
  }
}
```

---

## vite.config.ts

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    nodePolyfills({ globals: { Buffer: true, process: true } }), // must be first
    wasm(),
    topLevelAwait(),
    react(),
  ],
  server: {
    port: 5173,
    fs: {
      // Allow serving WASM files from sibling local packages
      allow: [
        path.resolve(__dirname),
        path.resolve(__dirname, '../rgb-sdk-web'),
        path.resolve(__dirname, '../rgb-lib-wasm'),
        path.resolve(__dirname, '../rgb-sdk-core'),
      ],
    },
  },
  optimizeDeps: {
    // Don't pre-bundle — these contain WASM / local file: symlinks
    exclude: ['@utexo/rgb-sdk-web', '@utexo/rgb-lib-wasm', '@utexo/rgb-sdk-core'],
  },
});
```

> `server.fs.allow` and `optimizeDeps.exclude` are only needed while using the
> local `file:` reference. Remove them when switching to a published npm package.

---

## Global State (store.ts)

One Zustand store for simplicity:

```ts
type Store = {
  // SDK
  sdkStatus: 'idle' | 'loading' | 'ready' | 'error';
  sdkError: string | null;

  // Wallets
  manager: WalletManager | null;
  utexo: UTEXOWallet | null;
  keys: GeneratedKeys | null;

  // Activity log
  log: Array<{ ts: string; msg: string; level: 'ok' | 'err' | 'warn' | 'info' }>;

  // Actions
  setSdkStatus: (s: Store['sdkStatus'], err?: string) => void;
  setManager: (m: WalletManager | null) => void;
  setUtexo: (u: UTEXOWallet | null) => void;
  setKeys: (k: GeneratedKeys | null) => void;
  addLog: (msg: string, level?: 'ok' | 'err' | 'warn' | 'info') => void;
  clearLog: () => void;
};
```

`setManager` and `setUtexo` also call `session.save()` internally so session
stays in sync automatically.

---

## Session Persistence (src/lib/session.ts)

Wallets are in-memory — a page refresh clears Zustand. `session.ts` saves the
minimum config to `sessionStorage` and recreates the wallet on startup:

```ts
// Called once in App.tsx after initWasm() resolves
export async function autoRestore(): Promise<{ manager, utexo } | null>
```

Flow:
1. Read `sessionStorage['rgb_wallet_session']` → `{ type, mnemonic, network, transportEndpoint?, indexerUrl? }`
2. If `type === 'manager'`: call `deriveKeysFromMnemonic(network, mnemonic)` → `WalletManager.create()` → optional `goOnline()`
3. If `type === 'utexo'`: `new UTEXOWallet(mnemonic, { network, transportEndpoint })` → `initialize()` → optional `goOnline()`
4. Store result in Zustand

---

## App.tsx — SDK Init

```tsx
function App() {
  const setSdkStatus = useStore(s => s.setSdkStatus);
  const setManager = useStore(s => s.setManager);
  const setUtexo = useStore(s => s.setUtexo);
  const addLog = useStore(s => s.addLog);

  useEffect(() => {
    setSdkStatus('loading');
    initWasm()
      .then(() => {
        setSdkStatus('ready');
        addLog('SDK initialized', 'ok');
        return autoRestore();
      })
      .then(restored => {
        if (restored?.manager) { setManager(restored.manager); addLog('WalletManager restored', 'ok'); }
        if (restored?.utexo)   { setUtexo(restored.utexo);     addLog('UTEXOWallet restored', 'ok'); }
      })
      .catch(e => {
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
          <Route path="/wallet-manager" element={<WalletManagerPage />} />
          <Route path="/utexo-wallet" element={<UtexoWalletPage />} />
          <Route path="/bitcoin" element={<BitcoinPage />} />
          <Route path="/rgb-assets" element={<RgbAssetsPage />} />
          <Route path="/backup" element={<BackupPage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
```

---

## StepFlow Component

Reused on WalletManager, UTEXOWallet, Bitcoin, and RGB Assets pages:

```tsx
// Each step is enabled only after the previous one succeeds
<StepFlow
  steps={[
    { label: '1. Begin', onClick: handleBegin },
    { label: '2. Sign PSBT', variant: 'warning', onClick: handleSign },
    { label: '3. Broadcast', variant: 'accent', onClick: handleEnd },
  ]}
  auto={{ label: 'Auto (1-click)', onClick: handleAuto }}
/>
```

Internally tracks `step: 0|1|2|3` and which intermediate values (unsigned PSBT,
signed PSBT) are held in local `useState`.

---

## Key Technical Notes

1. **`nodePolyfills` must be first plugin** — it injects `Buffer` before any
   module code runs. `bitcoinjs-lib` crashes without it.

2. **`optimizeDeps.exclude`** — prevents Vite's pre-bundler from trying to
   CommonJS-wrap WASM modules, which breaks async WASM init.

3. **Wallet instances in Zustand, not React state** — WASM objects are not plain
   JS values; React state clones on update. Zustand stores by reference.

4. **PSBT signing** — `manager.signPsbt(psbt)` / `utexo.signPsbt(psbt)` uses
   the embedded mnemonic via `WasmSigner`. No extra key input needed.

5. **Backup bytes** — `manager.getLastBackupBytes()` returns `Uint8Array`.
   Download: `URL.createObjectURL(new Blob([bytes]))`.

---

## Implementation Order

1. Project scaffold (package.json, vite.config.ts, Tailwind, App.tsx shell)
2. Zustand store + session.ts
3. Layout, Nav, OutputBox, StepFlow components
4. SDK init in App.tsx (verify "SDK initialized" log)
5. KeysPage
6. WalletManagerPage
7. UtexoWalletPage
8. BitcoinPage
9. RgbAssetsPage
10. BackupPage
11. HomePage (summary cards, quick links)
