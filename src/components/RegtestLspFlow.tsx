import { useEffect, useRef, useState } from 'react';
import {
  UTEXOWallet,
  generateKeys,
  type UtexoLsp,
} from '@utexo/rgb-sdk-web';
import { useStore } from '../store';
import { DEMO_VSS_URL } from '../lib/utils';
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
// Faucet RLN REST via the gateway proxy (start-lsp-web.sh: /dev/regular-rln/* → :3108).
const FAUCET_API = env.VITE_FAUCET_RLN_VIA_GATEWAY ?? `${CFG.gatewayHttp}/dev/regular-rln`;

type Role = 'recipient' | 'sender';

async function gatewayFund(address: string, amountBtc: number, mineBlocks: number) {
  const r = await fetch(`${CFG.gatewayHttp}/dev/regtest/fund`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address, amount_btc: amountBtc, mine_blocks: mineBlocks }),
  });
  if (!r.ok) throw new Error(`gateway /dev/regtest/fund → ${r.status}`);
}

async function faucetPost<T = unknown>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${FAUCET_API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    throw new Error(`faucet ${path} → ${r.status}: ${await r.text().catch(() => '')}`);
  }
  return (await r.json().catch(() => ({}))) as T;
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
    // skipConsistencyCheck=true matches the official example (regtest); the full
    // check can hang on a fresh esplora-indexed wallet.
    const wallet = new UTEXOWallet({
      network: 'regtest',
      mnemonic,
      password: `lsp-${r}`,
      proxyUrl: CFG.gatewayWs,
      transportEndpoint: CFG.transport,
      indexerUrl: CFG.indexer,
      skipConsistencyCheck: true,
      lspBaseUrl: CFG.lspBaseUrl,
      dataDir: `/rln_${r}_${fresh}`,
      nodeRuntimeId: `web-${r}-${fresh}`,
      vssUrl: DEMO_VSS_URL,
    });
    await wallet.init();
    await wallet.unlock();
    walletRef.current = wallet;
    if (!wallet.isOnline())
      throw new Error(`indexer unreachable at ${CFG.indexer} — is the LSP web stack running?`);
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
    // Channel RGB lives in the LDK layer (assetLocalAmount), not the on-chain rgb-lib
    // db — getAssetBalance says "not found" until the wallet sees the asset on-chain.
    try {
      const channels = (await walletRef.current?.listChannels()) ?? [];
      const chan = channels.find((c) => c.assetId === CFG.assetId);
      log(
        `${label} channel RGB: local=${chan?.assetLocalAmount ?? 0} ` +
          `(outbound ${chan?.outboundBalanceMsat ?? 0} msat)`,
        'ok'
      );
    } catch (e) {
      log(`${label} channel balance error: ${e}`);
    }
    try {
      await walletRef.current?.syncWallet();
      const bal = await walletRef.current?.getAssetBalance(CFG.assetId);
      log(`${label} on-chain asset balance: ${JSON.stringify(bal)}`, 'ok');
    } catch {
      log(`${label} on-chain asset balance: (asset not yet seen on-chain — expected)`);
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

  // ── Sender: setup → RGB top-up (RN a_topup) → pay the recipient's invoice ────
  // The LSP's virtual open gives the sender 0 local RGB (DEFAULT_CHANNEL_ASSET_AMOUNT
  // is LSP-side receive capacity, not a push) — paying an RGB invoice without a
  // deposit fails with RouteNotFound. Mirror the RN flow: receiveAsset registers an
  // LN↔RGB mapping with the LSP, the Faucet sends RGB on-chain to the LSP, and the
  // LSP pays our LN invoice over the channel once the transfer settles.
  async function runSender() {
    if (!invoice.trim()) {
      log('No recipient invoice yet — run the Recipient window first (or paste its invoice).', 'err');
      return;
    }
    const wallet = await setup('sender');
    const address = await wallet.getAddress();

    setPhase('topup');
    log('depositing RGB via lightning_receive (faucet → LSP → sender)…');
    const { lnInvoice: topupInvoice, rgbInvoice: topupRgbInvoice } =
      await lspRef.current!.receiveAsset({
        assetId: CFG.assetId,
        amountSats: PAYMENT_SATS,
        amountRgb: PAYMENT_RGB,
      });
    const decoded = await faucetPost<{
      recipient_id: string;
      transport_endpoints?: string[];
      assignment?: { type: string; value: number };
    }>('/decodergbinvoice', { invoice: topupRgbInvoice });
    const assignment =
      decoded.assignment?.type === 'Fungible' && (decoded.assignment?.value ?? 0) > 0
        ? decoded.assignment
        : { type: 'Fungible', value: PAYMENT_RGB };
    // The faucet's change from the stack's seed sends can sit pending until a
    // refresh — sendrgb then 403s with InsufficientAssets. Refresh + wait for
    // spendable before sending.
    log('waiting for faucet spendable RGB…');
    const faucetDeadline = Date.now() + 60_000;
    while (Date.now() < faucetDeadline) {
      await faucetPost('/refreshtransfers', { filter: [], skip_sync: false }).catch(() => {});
      const fb = await faucetPost<{ spendable?: number }>('/assetbalance', {
        asset_id: CFG.assetId,
      }).catch(() => null);
      if ((fb?.spendable ?? 0) >= PAYMENT_RGB) {
        log(`  faucet spendable: ${fb?.spendable}`);
        break;
      }
      await gatewayFund(address, 0.001, 1).catch(() => {});
      await sleep(2000);
    }
    await faucetPost('/sendrgb', {
      donation: false,
      fee_rate: 7,
      min_confirmations: 1,
      skip_sync: false,
      recipient_map: {
        [CFG.assetId]: [
          {
            recipient_id: decoded.recipient_id,
            assignment,
            transport_endpoints: decoded.transport_endpoints ?? ['rpc://127.0.0.1:3000/json-rpc'],
          },
        ],
      },
    });
    log('faucet sendrgb submitted — waiting for the on-chain transfer to settle…');

    const deadline = Date.now() + 120_000;
    let settledOnchain = false;
    while (Date.now() < deadline) {
      await gatewayFund(address, 0.001, 1).catch(() => {});
      await sleep(3000);
      try {
        await faucetPost('/refreshtransfers', { filter: [], skip_sync: false });
        const lt = await faucetPost<{
          transfers?: { kind?: string; status?: string; recipient_id?: string }[];
        }>('/listtransfers', { asset_id: CFG.assetId });
        // Match OUR transfer by recipient_id — the list also contains the stack's
        // seed sends (and comes newest-first), so "any settled Send" is a false positive.
        const send = (lt.transfers ?? []).find((t) => t.recipient_id === decoded.recipient_id);
        log(`  faucet Send: ${send?.status ?? 'none'}`);
        if (send?.status === 'Failed') throw new Error('faucet RGB send transfer failed');
        if (send?.status === 'Settled') {
          settledOnchain = true;
          break;
        }
      } catch (e) {
        if (String(e).includes('transfer failed')) throw e;
        log(`  topup poll: ${e}`);
      }
    }
    if (!settledOnchain) log('on-chain settle timeout — LSP may still be processing', 'err');

    // Keep the regtest chain moving while the LSP validates its receive and pays
    // our LN invoice (its receive needs a confirmation too).
    const miner = setInterval(() => {
      gatewayFund(address, 0.001, 1).catch(() => {});
    }, 3000);
    let lastTopupStatus = '';
    try {
      await lspRef.current!.awaitReceiveSettlement(topupInvoice, {
        timeoutMs: 120_000,
        pollIntervalMs: 3000,
        onProgress: (s) => {
          lastTopupStatus = s;
          log(`  topup invoice: ${s}`);
        },
      });
    } finally {
      clearInterval(miner);
    }
    if (lastTopupStatus !== 'Succeeded') {
      throw new Error(`RGB top-up did not settle (last status: ${lastTopupStatus})`);
    }
    log(`deposited ${PAYMENT_RGB} RGB via lightning_receive ✓`, 'ok');
    await showAssetBalance('sender (before)');

    setPhase('pay');
    log('paying the recipient invoice…');
    const res = await wallet.payLightningInvoice({ lnInvoice: invoice.trim() });
    const payHash = String(res.txid ?? '');
    log(`pay status: ${res.status ?? 'sent'} (payment hash ${payHash})`, 'ok');

    // Poll until Settled — each getLightningSendRequest poll also drives the wasm
    // node's queued RGB work (HTLC/commitment coloring), without which the HTLC
    // never leaves this node. Mirrors the RN flow's sender-side settle loop.
    setPhase('settle');
    const payDeadline = Date.now() + 120_000;
    let payStatus: string | null = 'WaitingCounterparty';
    while (Date.now() < payDeadline) {
      await gatewayFund(address, 0.001, 1).catch(() => {});
      await sleep(3000);
      payStatus = await wallet.getLightningSendRequest(payHash);
      log(`  send status: ${payStatus ?? 'Pending'}`);
      if (payStatus === 'Settled' || payStatus === 'Failed') break;
    }
    if (payStatus === 'Failed') throw new Error('payment Failed');
    if (payStatus !== 'Settled') log('send did not settle within timeout', 'err');
    else log('payment Settled ✓', 'ok');

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
      hint="Open this page in TWO windows — one Recipient, one Sender. Recipient creates an asset invoice; Sender first deposits RGB via lightning_receive (faucet → LSP → sender, the RN a_topup pattern), then pays the invoice over Lightning via the LSP. Requires scripts/start-lsp-web.sh."
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
