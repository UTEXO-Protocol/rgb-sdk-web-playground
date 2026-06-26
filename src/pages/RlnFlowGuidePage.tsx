import React, { useState } from 'react';
import {
  generateKeys,
  RlnWalletManager,
} from '@utexo/rgb-sdk-web';
import { useStore } from '../store';
import type { WalletInstance, WalletConfig } from '../store';
import { Section } from '../components/Section';
import { Field, inputCls, selectCls } from '../components/Field';
import { Btn } from '../components/Btn';
import { OutputBox } from '../components/OutputBox';
import {
  json,
  proxyIndexerUrl,
  getIndexerUrl,
  getTransportEndpoint,
  FAUCET_BASE_URL,
  FAUCET_TOKEN,
} from '../lib/utils';
import { saveSessions, setUrlWallet } from '../lib/session';

let flowIdCounter = 0;
function nextFlowWalletId() {
  return 'rln_flow_' + (++flowIdCounter) + '_' + Date.now();
}

const FLOW_NETWORKS = ['utexo', 'testnet'] as const;

/** Console-style reference script (copy into DevTools or read alongside “Run demo flow”). */
const FLOW_SCRIPT = `// RLN wallet — default UTEXO-network flow (see also UTEXO Wallet → Fund via Faucet)
// Open the browser console; "Run demo flow" logs the same steps live.
//
// IMPORTANT: rln-wasm-sdk allows only ONE sdk.initValue(password, mnemonic) per browser tab.
// Strings in the WASM include: "sdk is already initialized with different password" /
// "sdk is already initialized with different mnemonic". So: one RlnWalletManager.create()
// per full page load, or always reuse the same password+mnemonic pair the tab was first
// initialized with (@utexo/rgb-sdk-web → RlnWasmBinding.create → RlnWasmSdk.initValue).

console.log('[RLN flow] 1) Generate mnemonic');
// const keys = await generateKeys('utexo');

console.log('[RLN flow] 2) Create RlnWalletManager (password encrypts the local DB)');
// const wallet = await RlnWalletManager.create({
//   mnemonic: keys.mnemonic,
//   password: '<your-password>',
//   network: 'utexo',
//   transportEndpoint: '<rpc://... or default from DEFAULT_TRANSPORT_ENDPOINTS>',
// });

console.log('[RLN flow] 3) Go online (indexer URL optional — SDK uses DEFAULT_INDEXER_URLS[network])');
// await wallet.goOnline(undefined, false);

console.log('[RLN flow] 4) Fund BTC — same thunderstack faucet as UTEXO Wallet (testnet/utexo addresses)');
// const addr = await wallet.getAddress();
// await fetch(FAUCET_BASE_URL + '/sendbtc', {
//   method: 'POST',
//   headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + FAUCET_TOKEN },
//   body: JSON.stringify({ address: addr, amount: 10000, fee_rate: 5, skip_sync: false }),
// });

console.log('[RLN flow] 5) Wait for confirmation, then sync / refresh');
// await wallet.syncWallet();
// await wallet.refreshWallet();

console.log('[RLN flow] 6) Issue RGB (NIA) — needs Lightning node (transportEndpoint at create time)');
// const asset = await wallet.issueAssetNia({
//   ticker: 'DEMO', name: 'Demo', precision: 0, amounts: [1000],
// });
// console.log('assetId', asset.assetId);

console.log('[RLN flow] 7) A second wallet (e.g. Bob) needs a separate browser tab or page reload + new init');
`;

async function fundViaThunderstackFaucet(address: string, amount: number, feeRate: number): Promise<unknown> {
  const resp = await fetch(FAUCET_BASE_URL + '/sendbtc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + FAUCET_TOKEN },
    body: JSON.stringify({ address, amount, fee_rate: feeRate, skip_sync: false }),
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status + ': ' + (await resp.text()));
  return resp.json();
}

export function RlnFlowGuidePage() {
  const sdkStatus = useStore((s) => s.sdkStatus);
  const addWallet = useStore((s) => s.addWallet);
  const updateWallet = useStore((s) => s.updateWallet);
  const setActiveWalletId = useStore((s) => s.setActiveWalletId);
  const addLog = useStore((s) => s.addLog);
  const wallets = useStore((s) => s.wallets);

  const [network, setNetwork] = useState<(typeof FLOW_NETWORKS)[number]>('utexo');
  const [password, setPassword] = useState('demo-rln-flow');
  const [transport, setTransport] = useState(() => getTransportEndpoint('utexo'));
  const [indexerUrl, setIndexerUrl] = useState(() => getIndexerUrl('utexo'));
  const [faucetAmount, setFaucetAmount] = useState('10000');
  const [faucetFeeRate, setFaucetFeeRate] = useState('5');
  const [running, setRunning] = useState(false);
  const [runOut, setRunOut] = useState('');

  const faucetOk = network === 'utexo' || network === 'testnet';
  const existingRln = wallets.filter((w) => w.type === 'rln');
  const rlnBlocked = existingRln.length > 0;

  function logBoth(msg: string) {
    console.log(msg);
    addLog(msg, 'info');
  }

  async function runDemoFlow() {
    if (sdkStatus !== 'ready') {
      setRunOut('Wait until the SDK is ready.');
      return;
    }
    if (!password.trim()) {
      setRunOut('Enter a password for RlnWalletManager.create().');
      return;
    }
    if (rlnBlocked) {
      setRunOut(
        'This tab already has an RLN wallet (restored or created). The RLN WASM SDK only allows one ' +
          'initValue(password, mnemonic) per page load — see RlnWasmBinding.create in @utexo/rgb-sdk-web. ' +
          'Use your existing wallet on the RLN Wallet page, or open a fresh tab / full reload after removing RLN wallets from storage.'
      );
      return;
    }
    setRunning(true);
    setRunOut('');
    const lines: string[] = [];

    const push = (s: string) => {
      lines.push(s);
      setRunOut(lines.join('\n'));
    };

    try {
      logBoth('[RLN flow] 1) generateKeys()');
      const aliceKeys = await generateKeys(network);
      console.log('[RLN flow] Mnemonic (demo only):', aliceKeys.mnemonic.slice(0, 20) + '…');
      push('Mnemonic generated (see console for prefix).');

      logBoth('[RLN flow] 2) RlnWalletManager.create() — only one per tab (rln-wasm-sdk singleton)');
      const transportEp = transport.trim() || undefined;
      const pwd = password.trim();

      const managerAlice = await RlnWalletManager.create({
        mnemonic: aliceKeys.mnemonic,
        password: pwd,
        network,
        transportEndpoint: transportEp,
      });
      const idAlice = nextFlowWalletId();
      const configAlice: WalletConfig = {
        network,
        indexerUrl: indexerUrl.trim(),
        transportEndpoint: transport,
        masterFingerprint: '',
        xpubVan: '',
        xpubCol: '',
        mnemonic: aliceKeys.mnemonic,
        password: pwd,
      };
      const wAlice: WalletInstance = {
        id: idAlice,
        label: 'RLN Flow — demo',
        type: 'rln',
        config: configAlice,
        instance: managerAlice,
        online: false,
      };
      addWallet(wAlice);

      const getAlice = () =>
        useStore.getState().wallets.find((w) => w.id === idAlice)?.instance as RlnWalletManager;

      push('RlnWalletManager added to the app wallet list.');

      logBoth('[RLN flow] 3) goOnline()');
      const idx = indexerUrl.trim() ? proxyIndexerUrl(indexerUrl.trim()) : undefined;
      await getAlice().goOnline(idx, false);
      updateWallet(idAlice, { online: true });
      push('Wallet is online.');

      if (faucetOk) {
        logBoth('[RLN flow] 4) Fund via Faucet (thunderstack) — Alice');
        setActiveWalletId(idAlice);
        const addr = await getAlice().getAddress();
        const amount = parseInt(faucetAmount, 10) || 10000;
        const feeRate = parseInt(faucetFeeRate, 10) || 5;
        console.log('[RLN flow] Faucet address:', addr, 'amount:', amount);
        const faucetResult = await fundViaThunderstackFaucet(addr, amount, feeRate);
        console.log('[RLN flow] Faucet response:', faucetResult);
        push('Alice funded via faucet.\n' + json(faucetResult));
        addLog('Faucet funded Alice: ' + amount + ' sats', 'ok');
      } else {
        logBoth('[RLN flow] 4) Skipping faucet (use utexo or testnet for thunderstack faucet)');
        push('Faucet skipped for this network — switch network to utexo or testnet, or fund manually.');
      }

      logBoth('[RLN flow] 5) syncWallet() / refreshWallet() on Alice');
      try {
        await getAlice().syncWallet();
        await getAlice().refreshWallet();
        push('Alice sync + refresh done.');
      } catch (e) {
        push('sync/refresh note: ' + e);
      }

      const node = getAlice().getLightningNode();
      if (node) {
        logBoth('[RLN flow] 6) issueAssetNia() on Alice');
        const asset = await getAlice().issueAssetNia({
          ticker: 'DEMO',
          name: 'Flow Demo',
          precision: 0,
          amounts: [1000],
        });
        console.log('[RLN flow] Issued asset:', asset);
        push('Issued NIA asset:\n' + json(asset));
        addLog('issueAssetNia completed on Alice', 'ok');
      } else {
        logBoth('[RLN flow] 6) Skipping issueAssetNia (no Lightning node — set transport endpoint at create)');
        push('issueAssetNia skipped: add a transportEndpoint when creating the wallet to enable Lightning + NIA issue.');
      }

      setActiveWalletId(idAlice);
      const all = useStore.getState().wallets;
      saveSessions(all, idAlice);
      setUrlWallet(idAlice);

      logBoth('[RLN flow] 7) Done — active wallet: RLN Flow demo. Use RLN Wallet page for send/receive/LN.');
      push('Flow finished. Demo wallet is active in the header switcher.');
    } catch (e) {
      const err = String(e);
      console.error('[RLN flow] Error:', e);
      addLog('RLN flow failed: ' + err, 'err');
      push('Error: ' + err);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <h1 className="text-[#58a6ff] text-2xl font-bold mb-1">RLN flow (console guide)</h1>
      <p className="text-[#8b949e] text-sm mb-6">
        Reference script and a one-click demo: one <code className="text-[#c9d1d9]">RlnWalletManager</code> per browser tab
        (the RLN WASM module allows a single <code className="text-[#c9d1d9]">initValue(password, mnemonic)</code>),
        then go online, fund via the same thunderstack faucet as <span className="text-[#c9d1d9]">UTXO Wallet</span>, and issue NIA when Lightning is configured.
      </p>
      {rlnBlocked && (
        <p className="text-[#d29922] text-sm mb-4 border border-[#d29922]/40 rounded-md px-3 py-2 bg-[#2a1f00]/40">
          This session already has {existingRln.length} RLN wallet(s). The automated flow is disabled so you do not hit
          “sdk is already initialized with different password” from <code className="text-[#c9d1d9]">rln-wasm-sdk</code>.
          Use the <strong className="text-[#c9d1d9]">RLN Wallet</strong> page, or a fresh tab after a full reload with no RLN restore.
        </p>
      )}

      <Section title="Reference: console.log flow" hint="Copy or read beside the live demo. Real execution logs to the browser console and the Activity Log.">
        <pre className="bg-[#0d1117] border border-[#30363d] rounded p-4 text-xs font-mono text-[#8b949e] overflow-x-auto whitespace-pre max-h-96 overflow-y-auto">
          {FLOW_SCRIPT}
        </pre>
      </Section>

      <Section title="Run demo flow" hint="Creates one RLN wallet (session saved). Run only when no other RLN wallet exists in this tab; demo password is not for production.">
        <div className="flex gap-4 mb-4 flex-wrap">
          <Field label="Network">
            <select
              value={network}
              onChange={(e) => {
                const n = e.target.value as (typeof FLOW_NETWORKS)[number];
                setNetwork(n);
                setIndexerUrl(getIndexerUrl(n));
                setTransport(getTransportEndpoint(n));
              }}
              className={selectCls}
            >
              {FLOW_NETWORKS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Password">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputCls}
              autoComplete="off"
            />
          </Field>
        </div>
        <Field label="Transport endpoint (Lightning + RGB — required for issueAssetNia)">
          <input value={transport} onChange={(e) => setTransport(e.target.value)} className={inputCls} placeholder="rpc://..." />
        </Field>
        <Field label="Indexer URL (optional — blank uses SDK default for network)">
          <input value={indexerUrl} onChange={(e) => setIndexerUrl(e.target.value)} className={inputCls} />
        </Field>
        <div className="flex gap-4 mt-4 mb-4 flex-wrap">
          <Field label="Faucet amount (sats)">
            <input
              type="number"
              value={faucetAmount}
              onChange={(e) => setFaucetAmount(e.target.value)}
              className={inputCls}
              min="1000"
            />
          </Field>
          <Field label="Faucet fee rate (sat/vB)">
            <input
              type="number"
              value={faucetFeeRate}
              onChange={(e) => setFaucetFeeRate(e.target.value)}
              className={inputCls}
              min="1"
            />
          </Field>
        </div>
        <Btn variant="accent" onClick={runDemoFlow} disabled={running || sdkStatus !== 'ready' || rlnBlocked}>
          {running ? 'Running…' : 'Run demo flow (console + log)'}
        </Btn>
        <p className="text-xs text-[#8b949e] mt-3">
          Wallets in session: {wallets.length}. This flow adds one RLN wallet if none exists yet (see singleton note above).
        </p>
        <OutputBox value={runOut} />
      </Section>
    </div>
  );
}
