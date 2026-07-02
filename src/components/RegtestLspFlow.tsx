import { useEffect, useRef, useState } from 'react';
import {
  UTEXOWallet,
  generateKeys,
  type UtexoLsp,
} from '@utexo/rgb-sdk-web';
import { useStore } from '../store';
import { Section } from './Section';
import { Field, inputCls } from './Field';
import { Btn } from './Btn';
import { OutputBox } from './OutputBox';

// Config from .env.local (written by scripts/start-lsp-web.sh).
const env = import.meta.env as Record<string, string | undefined>;
const CFG = {
  assetId: env.VITE_LSP_REGTEST_ASSET_ID ?? '',
  lspPubkey: env.VITE_LSP_REGTEST_PEER_PUBKEY ?? '',
  lspPort: Number(env.VITE_LSP_REGTEST_LDK_PORT ?? 9745),
  lspBaseUrl: env.VITE_LSP_BASE_URL ?? '/lsp',
  gatewayWs: env.VITE_RLN_GATEWAY_WS ?? 'ws://127.0.0.1:3001',
  transport: env.VITE_RLN_TRANSPORT ?? 'http://127.0.0.1:3001/rgb/json-rpc',
  indexer: env.VITE_RLN_INDEXER ?? 'http://127.0.0.1:3002',
  gatewayHttp: env.VITE_RLN_GATEWAY_HTTP ?? 'http://127.0.0.1:3001',
};
const BC_NAME = 'utexo-lsp-flow';
const PAYMENT_SATS = 3000;
const PAYMENT_RGB = 1;

type Role = 'recipient' | 'sender';

async function gatewayFund(address: string, amountBtc: number, mineBlocks: number) {
  const r = await fetch(`${CFG.gatewayHttp}/dev/regtest/fund`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address, amount_btc: amountBtc, mine_blocks: mineBlocks }),
  });
  if (!r.ok) throw new Error(`gateway /dev/regtest/fund → ${r.status}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Stable mnemonic per role — re-running the same role in the same tab reuses it
// (sdk.initValue is idempotent for the same mnemonic), so retries don't collide.
async function roleMnemonic(role: Role): Promise<string> {
  const key = `lsp-flow-mnemonic-${role}`;
  const saved = localStorage.getItem(key);
  if (saved) return saved;
  const k = await generateKeys('regtest');
  localStorage.setItem(key, k.mnemonic);
  return k.mnemonic;
}

function deleteDb(name: string): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
    // onblocked fires if a connection is still open — resolve anyway after a beat.
    setTimeout(resolve, 3000);
  });
}

// One RLN wallet can be initialized per browser tab. The demo auto-restores saved
// wallets on load (initializing the SDK + persisting node runtime state to IndexedDB),
// so the flow needs a clean tab. This wipes localStorage + IndexedDB, then reloads.
async function clearWalletsAndReload() {
  localStorage.removeItem('rgb_wallet_sessions');
  sessionStorage.clear();
  try {
    const idb = indexedDB as { databases?: () => Promise<{ name?: string }[]> };
    const dbs = (await idb.databases?.()) ?? [];
    await Promise.all(dbs.map((d) => (d.name ? deleteDb(d.name) : Promise.resolve())));
  } catch {
    /* best-effort */
  }
  location.reload();
}

export function RegtestLspFlow() {
  const addLog = useStore((s) => s.addLog);
  const storeWallets = useStore((s) => s.wallets);

  const [role, setRole] = useState<Role>('recipient');
  const [running, setRunning] = useState(false);
  const [out, setOut] = useState('');
  const [invoice, setInvoice] = useState(''); // recipient: created; sender: to pay
  const [phase, setPhase] = useState('idle');

  const walletRef = useRef<UTEXOWallet | null>(null);
  const lspRef = useRef<UtexoLsp | null>(null);
  const bcRef = useRef<BroadcastChannel | null>(null);

  const log = (m: string, level: 'info' | 'ok' | 'err' = 'info') => {
    setOut((p) => p + (p ? '\n' : '') + m);
    addLog(`[lsp-flow] ${m}`, level === 'ok' ? 'ok' : level === 'err' ? 'err' : 'info');
  };

  // Cross-window coordination: recipient publishes its invoice, sender receives it.
  useEffect(() => {
    const bc = new BroadcastChannel(BC_NAME);
    bcRef.current = bc;
    bc.onmessage = (e) => {
      if (e.data?.type === 'invoice' && typeof e.data.lnInvoice === 'string') {
        setInvoice(e.data.lnInvoice);
        addLog('[lsp-flow] received invoice from Recipient window', 'ok');
      }
    };
    return () => bc.close();
  }, [addLog]);

  const configured = CFG.assetId && CFG.lspPubkey;
  const hasOtherWallet = storeWallets.length > 0;

  // ── Shared setup: wallet → online → fund → utxos → LSP channel ──────────────
  async function setup(r: Role): Promise<UTEXOWallet> {
    setPhase('init');
    log(`creating ${r} wallet (regtest)…`);
    const mnemonic = await roleMnemonic(r);
    // Fresh data_dir + nodeRuntimeId each run → the wallet does a full chain
    // scan instead of restoring a stale checkpoint from a previous run (which
    // fails with "introduced chain cannot connect" after the regtest chain
    // advances/resets). The mnemonic stays stable so funding hits the same keys.
    const fresh = Date.now().toString(16);
    const wallet = await UTEXOWallet.create({
      network: 'regtest',
      mnemonic,
      password: `lsp-${r}`,
      proxyUrl: CFG.gatewayWs,
      transportEndpoint: CFG.transport,
      lspBaseUrl: CFG.lspBaseUrl,
      dataDir: `/rln_${r}_${fresh}`,
      nodeRuntimeId: `web-${r}-${fresh}`,
    });
    walletRef.current = wallet;
    // skipConsistencyCheck=true matches the official example (regtest); the full
    // check can hang on a fresh esplora-indexed wallet.
    await wallet.goOnline(CFG.indexer, true);
    const address = await wallet.getAddress();
    log(`address: ${address}`);

    setPhase('fund');
    log('funding via gateway (1 BTC, mine 6)…');
    await gatewayFund(address, 1, 6);
    for (let i = 0; i < 20; i++) {
      await wallet.syncWallet();
      const b = (await wallet.getBtcBalance()) as { vanilla?: { spendable?: number } };
      if ((b?.vanilla?.spendable ?? 0) > 0) break;
      await sleep(2000);
    }

    setPhase('utxos');
    log('creating UTXOs…');
    await wallet.createUtxos({ upTo: false, num: 10, feeRate: 7 });
    await gatewayFund(address, 0.001, 1);
    await wallet.syncWallet();

    // On-chain setup done — now attach the wallet to the LN node (deferred so
    // the funding/UTXO ops above don't collide with the node runtime).
    log('attaching LN node…');
    wallet.attachLightningNode();

    setPhase('channel');
    log('connecting to LSP + waiting for RGB channel (LSP opens + pushes asset)…');
    const lsp = await wallet.createLsp({
      baseUrl: CFG.lspBaseUrl,
      peerPubkey: CFG.lspPubkey,
      peerHost: '127.0.0.1',
      peerPort: CFG.lspPort,
    });
    lspRef.current = lsp;
    await lsp.connect();
    const chan = await lsp.waitForChannel(CFG.assetId, {
      pollIntervalMs: 3000,
      timeoutMs: 180_000,
      onProgress: (m) => log(`  ${r} ${m}`),
      onEachPoll: () => gatewayFund(address, 0.001, 1).catch(() => {}),
    });
    log(`RGB channel usable ✓ cap=${chan.capacitySat} sat outbound=${chan.outboundBalanceMsat} msat`, 'ok');
    return wallet;
  }

  async function showAssetBalance(label: string) {
    try {
      await walletRef.current?.syncWallet();
      const bal = await walletRef.current?.getAssetBalance(CFG.assetId);
      log(`${label} asset balance: ${JSON.stringify(bal)}`, 'ok');
    } catch (e) {
      log(`${label} balance error: ${e}`);
    }
  }

  // ── Recipient: create invoice → publish → await settlement ──────────────────
  async function runRecipient() {
    const wallet = await setup('recipient');
    setPhase('invoice');
    const { lnInvoice } = await wallet.createLightningInvoice({
      amountSats: PAYMENT_SATS,
      expirySeconds: 3600,
      asset: { assetId: CFG.assetId, amount: PAYMENT_RGB },
    });
    setInvoice(lnInvoice);
    bcRef.current?.postMessage({ type: 'invoice', lnInvoice });
    log('LN invoice created + published to the Sender window ✓', 'ok');
    await showAssetBalance('recipient (before)');

    setPhase('await');
    log('waiting for the Sender to pay…');
    await lspRef.current!.awaitReceiveSettlement(lnInvoice, {
      timeoutMs: 120_000,
      pollIntervalMs: 3000,
      onProgress: (s) => log(`  invoice: ${s}`),
    });
    log('payment received & settled ✓', 'ok');
    await showAssetBalance('recipient (after)');
    setPhase('done');
  }

  // ── Sender: setup → pay the recipient's invoice ─────────────────────────────
  async function runSender() {
    if (!invoice.trim()) {
      log('No recipient invoice yet — run the Recipient window first (or paste its invoice).', 'err');
      return;
    }
    const wallet = await setup('sender');
    await showAssetBalance('sender (before)');
    setPhase('pay');
    log('paying the recipient invoice…');
    const res = await wallet.payLightningInvoice({ lnInvoice: invoice.trim() });
    log(`pay status: ${res.status ?? 'sent'} (txid ${res.txid})`, 'ok');
    await showAssetBalance('sender (after)');
    setPhase('done');
  }

  async function run() {
    setOut('');
    setRunning(true);
    try {
      if (role === 'recipient') await runRecipient();
      else await runSender();
    } catch (e) {
      log(`Fatal: ${e}`, 'err');
      setPhase('error');
    } finally {
      setRunning(false);
    }
  }

  return (
    <Section
      title="Regtest two-window flow"
      hint="Open this page in TWO windows — one Recipient, one Sender. Recipient creates an asset invoice; Sender pays it over Lightning via the LSP. Requires scripts/start-lsp-web.sh."
    >
      {!configured && (
        <p className="text-[#f85149] text-sm mb-3">
          Not configured — run <code>./scripts/start-lsp-web.sh</code> (writes .env.local) and restart{' '}
          <code>npm run dev</code>.
        </p>
      )}
      {hasOtherWallet && (
        <div className="text-[#f85149] text-xs mb-3 flex items-center gap-2 flex-wrap">
          <span>
            This tab already initialized an RLN wallet (auto-restored on load). Only one wallet can
            exist per tab — clear it before running the flow.
          </span>
          <Btn variant="danger" onClick={clearWalletsAndReload}>Clear wallets &amp; reload</Btn>
        </div>
      )}

      <div className="bg-[#161b22] border border-[#30363d] rounded p-3 font-mono text-xs mb-4 space-y-0.5">
        <div><span className="text-[#8b949e]">asset:</span> {CFG.assetId || '(unset)'}</div>
        <div><span className="text-[#8b949e]">lsp pubkey:</span> {CFG.lspPubkey ? CFG.lspPubkey.slice(0, 24) + '…' : '(unset)'}</div>
        <div><span className="text-[#8b949e]">lsp peer:</span> 127.0.0.1:{CFG.lspPort}</div>
        <div><span className="text-[#8b949e]">gateway:</span> {CFG.gatewayWs}</div>
      </div>

      <div className="flex gap-2 mb-3">
        <Btn variant={role === 'recipient' ? 'primary' : 'secondary'} onClick={() => setRole('recipient')} disabled={running}>
          Recipient
        </Btn>
        <Btn variant={role === 'sender' ? 'primary' : 'secondary'} onClick={() => setRole('sender')} disabled={running}>
          Sender
        </Btn>
        <Btn variant="accent" onClick={run} disabled={running || !configured || hasOtherWallet}>
          {running ? `Running… (${phase})` : `Run ${role}`}
        </Btn>
      </div>

      <Field label={role === 'recipient' ? 'Created invoice (auto-shared to Sender window)' : 'Recipient invoice (auto-filled, or paste)'}>
        <input value={invoice} onChange={(e) => setInvoice(e.target.value)} className={inputCls} placeholder="lnbcrt…" />
      </Field>

      <OutputBox value={out} />
    </Section>
  );
}
