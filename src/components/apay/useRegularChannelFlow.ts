// Regular-channel flow — the native Faucet RLN acts as a routing hub and opens
// a REGULAR (on-chain funded, NOT virtual) RGB channel to the browser wasm
// node via its REST /openchannel: with_anchors + asset_amount 200 +
// push_asset_amount 100 seeds RGB balance on BOTH sides in one step. Then a
// payment is tested in each direction over that channel (wasm → hub, hub →
// wasm) and verified via channel assetLocalAmount deltas on both sides.
//
// The gateway relay is outbound-only (browser ws → native tcp), so the wasm
// node dials the hub FIRST; /openchannel with a bare pubkey then reuses the
// existing P2P session (native parse_peer_info accepts pubkey-only for
// already-connected peers). Single window — no BroadcastChannel needed.
import { useCallback, useRef, useState } from 'react';
import { UTEXOWallet, generateKeys } from '@utexo/rgb-sdk-web';
import { useStore } from '../../store';
import {
  CFG,
  CHANNEL_TIMEOUT_S,
  FAUCET_LDK_PORT,
  KEYSEND_REPRO_ASSET_AMOUNT,
  POLL_INTERVAL_MS,
  REGULAR_CHANNEL_ASSET_AMOUNT,
  REGULAR_CHANNEL_CAPACITY_SAT,
  REGULAR_CHANNEL_PUSH_ASSET_AMOUNT,
  REGULAR_CHANNEL_PUSH_MSAT,
  REGULAR_PAY_ASSET_AMOUNT,
  REGULAR_PAYBACK_ASSET_AMOUNT,
  REGULAR_PAY_MSAT,
  SETTLE_TIMEOUT_S,
  faucetGet,
  faucetPost,
  gatewayFund,
  short,
  sleep,
  type LogEntry,
  type Phase,
} from './config';

export interface RegularChannelInfo {
  channelId: string;
  capacitySat: number;
  wasmRgb: number;
  hubRgb: number;
}

export interface PaymentInfo {
  direction: 'wasm→hub' | 'hub→wasm';
  paymentHash: string;
  status: string;
}

export interface RegularVerdict {
  ok: boolean;
  detail: string;
}

/** Outcome of a keysend test (either direction; channel_issue.md repro). */
export interface ReproOutcome {
  kind: 'reproduced' | 'settled' | 'inconclusive';
  detail: string;
}

/** Outcome of the cooperative close + on-chain settle check. */
export interface CloseOutcome {
  kind: 'settled' | 'partial' | 'incomplete';
  detail: string;
}

/** On-chain balances observed after the cooperative close. */
export interface OnchainSettle {
  wasmSettled: number;
  wasmSpendable: number;
  wasmExpected: number;
  hubSpendable: number;
  hubExpectedDelta: number;
}

/** Native /listchannels row (snake_case REST shape). */
interface HubChannel {
  channel_id: string;
  peer_pubkey: string;
  status?: string;
  ready: boolean;
  is_usable: boolean;
  capacity_sat: number;
  asset_id?: string | null;
  asset_local_amount?: number | null;
  asset_remote_amount?: number | null;
  virtual_open_mode?: string | null;
}

// One RLN wallet per tab, shared across BOTH sections (RegularChannelFlow and
// KeysendReproFlow mount separate hook instances on the same page) — a second
// wallet in the same tab would race the first one's loops.
let tabHasFlowWallet = false;

async function stableMnemonic(): Promise<string> {
  const key = 'apay-flow-mnemonic-regular';
  const saved = localStorage.getItem(key);
  if (saved) return saved;
  const k = await generateKeys('regtest');
  localStorage.setItem(key, k.mnemonic);
  return k.mnemonic;
}

export type RegularFlowMode = 'full' | 'keysend_repro';

/**
 * mode 'full': open channel → invoice payment each way → (buttons: keysend /
 * close). mode 'keysend_repro': faithful channel_issue.md repro — the hub
 * keysend fires as the FIRST HTLC on the virgin channel, no invoice legs
 * warming up the commitment state beforehand.
 */
export function useRegularChannelFlow(mode: RegularFlowMode = 'full') {
  const addStoreLog = useStore((s) => s.addLog);

  const [phase, setPhase] = useState<Phase>('idle');
  const [log, setLog] = useState<LogEntry[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [channel, setChannel] = useState<RegularChannelInfo | null>(null);
  const [payment, setPayment] = useState<PaymentInfo | null>(null);
  const [verdict, setVerdict] = useState<RegularVerdict | null>(null);
  const [repro, setRepro] = useState<PaymentInfo | null>(null);
  const [reproOutcome, setReproOutcome] = useState<ReproOutcome | null>(null);
  const [reproRunning, setReproRunning] = useState(false);
  const [closeRunning, setCloseRunning] = useState(false);
  const [closeOutcome, setCloseOutcome] = useState<CloseOutcome | null>(null);
  const [onchain, setOnchain] = useState<OnchainSettle | null>(null);

  const walletRef = useRef<UTEXOWallet | null>(null);
  const hubPubkeyRef = useRef('');
  const wasmPubkeyRef = useRef('');
  const addressRef = useRef('');
  const abortRef = useRef(false);

  const addLog = useCallback(
    (msg: string, type: LogEntry['type'] = 'info') => {
      const time = new Date().toLocaleTimeString('en', { hour12: false });
      setLog((prev) => [...prev.slice(-500), { time, msg, type }]);
      addStoreLog(
        `[regular-channel] ${msg}`,
        type === 'success' ? 'ok' : type === 'error' ? 'err' : 'info'
      );
    },
    [addStoreLog]
  );

  const checkAbort = () => {
    if (abortRef.current) throw new Error('Cancelled');
  };

  // Wasm side of the hub channel. listChannels doubles as the drive beat —
  // it runs chain sync + queued RGB work (funding validation, HTLC coloring).
  async function readWasmChannel(wallet: UTEXOWallet) {
    const channels = await wallet.listChannels();
    return channels.find(
      (c) => c.peerPubkey === hubPubkeyRef.current && c.assetId === CFG.assetId
    );
  }

  async function readHubChannel(wasmPubkey: string): Promise<HubChannel | undefined> {
    const res = await faucetGet<{ channels?: HubChannel[] }>('/listchannels');
    return (res.channels ?? []).find(
      (c) => c.peer_pubkey === wasmPubkey && c.asset_id === CFG.assetId
    );
  }

  // The relay ws session can drop while blocks confirm — reconnect quietly.
  async function ensureHubConnected(wallet: UTEXOWallet, attempts = 4) {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      checkAbort();
      try {
        const peers = await wallet.listPeers().catch(() => []);
        if (peers.some((p) => p.pubkey === hubPubkeyRef.current && p.isConnected !== false))
          return;
        await wallet.connectPeer(`127.0.0.1:${FAUCET_LDK_PORT}`, hubPubkeyRef.current);
        return;
      } catch (e) {
        lastErr = e;
        addLog(`  hub connect attempt ${i + 1}/${attempts}: ${e}`);
        await sleep(2000);
      }
    }
    throw new Error(`could not connect to the hub peer after ${attempts} attempts: ${lastErr}`);
  }

  // Poll until the wasm side of the channel reports the expected local RGB —
  // this both verifies the payment landed and drives the RGB state machine.
  async function waitWasmRgb(
    wallet: UTEXOWallet,
    address: string,
    expected: number,
    label: string
  ): Promise<number> {
    const deadline = Date.now() + SETTLE_TIMEOUT_S * 1000;
    let last = -1;
    while (Date.now() < deadline) {
      checkAbort();
      await gatewayFund(address, 0.001, 1).catch(() => {});
      await wallet.syncWallet();
      const chan = await readWasmChannel(wallet);
      last = Number(chan?.assetLocalAmount ?? 0);
      if (last === expected) return last;
      addLog(`  ${label}: wasm channel RGB ${last} (want ${expected})`);
      await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(`${label}: wasm channel RGB stuck at ${last}, expected ${expected}`);
  }

  // Contrast probe: channel payments move ONLY the LDK channel state (what
  // listChannels → assetLocalAmount reads). The rgb-lib on-chain views —
  // listAssets / getAssetBalance on wasm, settled/spendable on the hub — do
  // NOT change until the channel closes and the close output is swept. The
  // native hub additionally reports channel RGB as offchain_outbound/_inbound
  // in /assetbalance; the wasm getAssetBalance has those fields too but they
  // come back 0 (the wasm rgb-lib wallet doesn't consult LDK channel state).
  async function logBalanceSnapshot(wallet: UTEXOWallet, label: string) {
    const assets = await wallet.listAssets().catch(() => null);
    const bal = await wallet.getAssetBalance(CFG.assetId).catch(() => null);
    const hub = await faucetPost<Record<string, unknown>>('/assetbalance', {
      asset_id: CFG.assetId,
    }).catch(() => null);
    addLog(`${label} — wasm listAssets: ${JSON.stringify(assets)}`);
    addLog(`${label} — wasm getAssetBalance: ${JSON.stringify(bal)}`);
    addLog(`${label} — hub /assetbalance: ${JSON.stringify(hub)}`);
  }

  // The last commitment dance can leave RGB fascia pending; the wasm node only
  // flushes it on a drive beat (listChannels → process_pending_rgb_transactions),
  // and while it sits pending LDK re-queues RgbTransactionPersistenceRequired on
  // every peer frame — flooding the console with trace logs. Keep the beat
  // running briefly after the flow ends so the sweep converges, then go quiet.
  async function postFlowFlush(wallet: UTEXOWallet) {
    for (let i = 0; i < 20 && !abortRef.current; i++) {
      await sleep(POLL_INTERVAL_MS);
      await wallet.listChannels().catch(() => {});
    }
  }

  async function runFlow() {
    // ── init ──────────────────────────────────────────────────────────────────
    setPhase('rc_init');
    const mnemonic = await stableMnemonic();
    const fresh = Date.now().toString(16);
    addLog(`→ create wallet  network=regtest dataDir=/regular_${fresh}`);
    const wallet = new UTEXOWallet({
      network: 'regtest',
      mnemonic,
      password: 'apay-regular',
      proxyUrl: CFG.gatewayWs,
      transportEndpoint: CFG.transport,
      indexerUrl: CFG.indexer,
      skipConsistencyCheck: true,
      dataDir: `/regular_${fresh}`,
      nodeRuntimeId: `regular-${fresh}`,
    });
    await wallet.init();
    walletRef.current = wallet;
    tabHasFlowWallet = true;
    if (!wallet.isOnline())
      throw new Error(`indexer unreachable at ${CFG.indexer} — is the LSP web stack running?`);
    const address = await wallet.getAddress();
    addressRef.current = address;
    addLog(`← wallet ready  address=${short(address)}`, 'success');

    // ── fund ──────────────────────────────────────────────────────────────────
    setPhase('rc_fund');
    addLog('→ gatewayFund  btc=1 mine=6');
    await gatewayFund(address, 1, 6);
    for (let i = 0; i < 20; i++) {
      checkAbort();
      await wallet.syncWallet();
      const b = (await wallet.getBtcBalance()) as { vanilla?: { spendable?: number } };
      if ((b?.vanilla?.spendable ?? 0) > 0) break;
      await sleep(2000);
    }
    addLog('← funded', 'success');

    // ── utxos ─────────────────────────────────────────────────────────────────
    setPhase('rc_utxos');
    addLog('→ createUtxos  num=10');
    await wallet.createUtxos({ upTo: false, num: 10, feeRate: 7 });
    await gatewayFund(address, 0.001, 1);
    await wallet.syncWallet();
    addLog('← createUtxos', 'success');

    // ── connect: wasm dials the hub so /openchannel can reuse the session ─────
    setPhase('rc_connect');
    addLog('attaching LN node…');
    wallet.attachLightningNode();
    const wasmPubkey =
      wallet.getNodePubkey() ?? (await wallet.getNodeInfo()).pubkey;
    wasmPubkeyRef.current = wasmPubkey;
    const hubInfo = await faucetGet<{ pubkey: string }>('/nodeinfo');
    hubPubkeyRef.current = hubInfo.pubkey;
    addLog(`wasm node ${short(wasmPubkey)} → hub ${short(hubInfo.pubkey)} :${FAUCET_LDK_PORT}`);
    await ensureHubConnected(wallet);
    addLog('← connected to hub via gateway relay', 'success');

    // ── channel: hub opens a regular RGB channel to the wasm peer ─────────────
    setPhase('rc_channel');
    // The faucet's change from the stack's seed sends can sit pending until a
    // refresh — openchannel then 403s with InsufficientAssets.
    addLog(`waiting for hub spendable RGB ≥ ${REGULAR_CHANNEL_ASSET_AMOUNT}…`);
    const spendableDeadline = Date.now() + 60_000;
    while (Date.now() < spendableDeadline) {
      checkAbort();
      await faucetPost('/refreshtransfers', { filter: [], skip_sync: false }).catch(() => {});
      const fb = await faucetPost<{ spendable?: number }>('/assetbalance', {
        asset_id: CFG.assetId,
      }).catch(() => null);
      if ((fb?.spendable ?? 0) >= REGULAR_CHANNEL_ASSET_AMOUNT) {
        addLog(`  hub spendable: ${fb?.spendable}`);
        break;
      }
      await gatewayFund(address, 0.001, 1).catch(() => {});
      await sleep(2000);
    }

    addLog(
      `→ hub /openchannel  capacity=${REGULAR_CHANNEL_CAPACITY_SAT} push_msat=${REGULAR_CHANNEL_PUSH_MSAT} ` +
        `asset=${REGULAR_CHANNEL_ASSET_AMOUNT} push_asset=${REGULAR_CHANNEL_PUSH_ASSET_AMOUNT} (regular, anchors)`
    );
    const open = await faucetPost<{ temporary_channel_id: string }>('/openchannel', {
      peer_pubkey_and_opt_addr: wasmPubkey,
      capacity_sat: REGULAR_CHANNEL_CAPACITY_SAT,
      push_msat: REGULAR_CHANNEL_PUSH_MSAT,
      asset_amount: REGULAR_CHANNEL_ASSET_AMOUNT,
      asset_id: CFG.assetId,
      push_asset_amount: REGULAR_CHANNEL_PUSH_ASSET_AMOUNT,
      public: false,
      with_anchors: true,
    });
    addLog(`← /openchannel  temp_id=${short(open.temporary_channel_id)}`, 'success');

    addLog('waiting for channel_ready on both sides…');
    const chanDeadline = Date.now() + CHANNEL_TIMEOUT_S * 1000;
    let wasmChan: Awaited<ReturnType<typeof readWasmChannel>> = undefined;
    let hubChan: HubChannel | undefined;
    while (Date.now() < chanDeadline) {
      checkAbort();
      await gatewayFund(address, 0.001, 1).catch(() => {});
      await ensureHubConnected(wallet, 2).catch(() => {});
      await wallet.syncWallet();
      wasmChan = await readWasmChannel(wallet);
      hubChan = await readHubChannel(wasmPubkey).catch(() => undefined);
      const wasmReady = Boolean(wasmChan?.isUsable);
      const hubReady = Boolean(hubChan?.ready);
      addLog(
        `  wasm ready=${wasmReady} rgb=${wasmChan?.assetLocalAmount ?? '?'}  hub ready=${hubReady} rgb=${
          hubChan?.asset_local_amount ?? '?'
        }`
      );
      if (wasmReady && hubReady) break;
      await sleep(POLL_INTERVAL_MS);
    }
    if (!wasmChan?.isUsable || !hubChan?.ready) {
      throw new Error('channel did not reach channel_ready on both sides in time');
    }
    if (hubChan.virtual_open_mode) {
      throw new Error(
        `expected a regular channel but hub reports virtual_open_mode=${hubChan.virtual_open_mode}`
      );
    }
    // The push seeds the wasm side — wait until the funding consignment is
    // validated and the pushed RGB is visible before paying.
    const wasmRgb0 = await waitWasmRgb(
      wallet,
      address,
      REGULAR_CHANNEL_PUSH_ASSET_AMOUNT,
      'push settle'
    );
    const hubRgb0 = Number(hubChan.asset_local_amount ?? 0);
    setChannel({
      channelId: hubChan.channel_id,
      capacitySat: hubChan.capacity_sat,
      wasmRgb: wasmRgb0,
      hubRgb: hubRgb0,
    });
    addLog(
      `regular channel ready ✓ id=${short(hubChan.channel_id)} wasm RGB=${wasmRgb0} hub RGB=${hubRgb0}`,
      'success'
    );
    await logBalanceSnapshot(wallet, 'after open');

    // ── keysend-repro mode: channel_issue.md exactly — the hub keysend is the
    // FIRST HTLC on the virgin channel; no invoice legs warm it up first ───────
    if (mode === 'keysend_repro') {
      setPhase('rc_keysend');
      await keysendReproCore(wallet);
      setPhase('done');
      return;
    }

    // ── pay: wasm → hub ───────────────────────────────────────────────────────
    setPhase('rc_pay');
    // Right after channel_ready the router can still miss the channel (pending
    // channel_update exchange) or report less spendable than the push (reserve
    // accounting settling) — gate on spendable outbound before paying.
    addLog(`waiting for wasm outbound liquidity ≥ ${REGULAR_PAY_MSAT} msat…`);
    const liqDeadline = Date.now() + CHANNEL_TIMEOUT_S * 1000;
    while (Date.now() < liqDeadline) {
      checkAbort();
      await gatewayFund(address, 0.001, 1).catch(() => {});
      const chan = await readWasmChannel(wallet);
      const outbound = Number(chan?.outboundBalanceMsat ?? 0);
      if (chan?.isUsable && outbound >= REGULAR_PAY_MSAT) {
        addLog(`  outbound: ${outbound} msat`);
        break;
      }
      addLog(`  outbound: ${outbound} msat (usable=${Boolean(chan?.isUsable)})`);
      await sleep(POLL_INTERVAL_MS);
    }

    addLog(`→ hub /lninvoice  asset_amount=${REGULAR_PAY_ASSET_AMOUNT}`);
    const hubInvoice = await faucetPost<{ invoice: string }>('/lninvoice', {
      amt_msat: REGULAR_PAY_MSAT,
      expiry_sec: 3600,
      asset_id: CFG.assetId,
      asset_amount: REGULAR_PAY_ASSET_AMOUNT,
    });
    addLog(`← hub invoice  ${short(hubInvoice.invoice, 32)}`);

    addLog('→ payLightningInvoice (wasm → hub)');
    // RouteNotFound right after open is transient (channel_update propagation)
    // — each retry runs a drive beat via readWasmChannel before re-sending.
    let sent: Awaited<ReturnType<typeof wallet.payLightningInvoice>> | undefined;
    for (let attempt = 1; ; attempt++) {
      checkAbort();
      await ensureHubConnected(wallet);
      try {
        sent = await wallet.payLightningInvoice({
          lnInvoice: hubInvoice.invoice,
          assetId: CFG.assetId,
          assetAmount: REGULAR_PAY_ASSET_AMOUNT,
        });
        break;
      } catch (e) {
        if (attempt >= 5 || !String(e).includes('RouteNotFound')) throw e;
        addLog(`  RouteNotFound (attempt ${attempt}/5) — retrying after a drive beat`);
        await gatewayFund(address, 0.001, 1).catch(() => {});
        await readWasmChannel(wallet);
        await sleep(POLL_INTERVAL_MS);
      }
    }
    setPayment({
      direction: 'wasm→hub',
      paymentHash: sent.txid,
      status: String(sent.status ?? 'Pending'),
    });
    addLog(`← sendPayment  hash=${short(sent.txid)} status=${sent.status}`);
    if (String(sent.status ?? '').toLowerCase() === 'failed') {
      throw new Error('wasm → hub payment failed immediately');
    }

    // getLightningSendRequest polls getPayment — each call is also a drive beat.
    const sendDeadline = Date.now() + SETTLE_TIMEOUT_S * 1000;
    let sendStatus: string | null = 'WaitingCounterparty';
    while (Date.now() < sendDeadline) {
      checkAbort();
      await gatewayFund(address, 0.001, 1).catch(() => {});
      await sleep(POLL_INTERVAL_MS);
      sendStatus = await wallet.getLightningSendRequest(sent.txid);
      setPayment({
        direction: 'wasm→hub',
        paymentHash: sent.txid,
        status: sendStatus ?? 'Pending',
      });
      addLog(`  wasm → hub: ${sendStatus ?? 'Pending'}`);
      if (sendStatus === 'Settled' || sendStatus === 'Failed') break;
    }
    if (sendStatus !== 'Settled') {
      throw new Error(`wasm → hub payment did not settle (last status: ${sendStatus})`);
    }
    const wasmRgb1 = await waitWasmRgb(
      wallet,
      address,
      wasmRgb0 - REGULAR_PAY_ASSET_AMOUNT,
      'pay settle'
    );
    const hubChan1 = await readHubChannel(wasmPubkey);
    const hubRgb1 = Number(hubChan1?.asset_local_amount ?? 0);
    setChannel((c) => (c ? { ...c, wasmRgb: wasmRgb1, hubRgb: hubRgb1 } : c));
    addLog(
      `wasm → hub Settled ✓  wasm RGB ${wasmRgb0} → ${wasmRgb1}, hub RGB ${hubRgb0} → ${hubRgb1}`,
      'success'
    );
    await logBalanceSnapshot(wallet, 'after pay');

    // ── payback: hub → wasm (smaller than the pay leg, so the final split is
    // asymmetric and visible on-chain after the channel closes) ────────────────
    setPhase('rc_payback');
    addLog(`→ createLightningInvoice (wasm)  asset_amount=${REGULAR_PAYBACK_ASSET_AMOUNT}`);
    const { lnInvoice } = await wallet.createLightningInvoice({
      amountSats: REGULAR_PAY_MSAT / 1000,
      expirySeconds: 3600,
      asset: { assetId: CFG.assetId, amount: REGULAR_PAYBACK_ASSET_AMOUNT },
    });
    addLog(`← wasm invoice  ${short(lnInvoice, 32)}`);

    await ensureHubConnected(wallet);
    addLog('→ hub /sendpayment (hub → wasm)');
    const hubSent = await faucetPost<{ payment_hash: string; status: string }>('/sendpayment', {
      invoice: lnInvoice,
    });
    setPayment({
      direction: 'hub→wasm',
      paymentHash: hubSent.payment_hash,
      status: hubSent.status ?? 'Pending',
    });
    addLog(`← /sendpayment  hash=${short(hubSent.payment_hash)} status=${hubSent.status}`);

    // Poll our invoice — invoiceStatus is a drive beat too (HTLC claim work).
    const recvDeadline = Date.now() + SETTLE_TIMEOUT_S * 1000;
    let recvStatus: string | null = 'WaitingCounterparty';
    while (Date.now() < recvDeadline) {
      checkAbort();
      await gatewayFund(address, 0.001, 1).catch(() => {});
      await sleep(POLL_INTERVAL_MS);
      recvStatus = await wallet.getLightningReceiveRequest(lnInvoice);
      setPayment({
        direction: 'hub→wasm',
        paymentHash: hubSent.payment_hash,
        status: recvStatus ?? 'Pending',
      });
      addLog(`  hub → wasm: ${recvStatus ?? 'Pending'}`);
      if (recvStatus === 'Settled' || recvStatus === 'Failed') break;
    }
    if (recvStatus !== 'Settled') {
      throw new Error(`hub → wasm payment did not settle (last status: ${recvStatus})`);
    }
    const wasmRgb2 = await waitWasmRgb(
      wallet,
      address,
      wasmRgb1 + REGULAR_PAYBACK_ASSET_AMOUNT,
      'payback settle'
    );
    const hubChan2 = await readHubChannel(wasmPubkey);
    const hubRgb2 = Number(hubChan2?.asset_local_amount ?? 0);
    setChannel((c) => (c ? { ...c, wasmRgb: wasmRgb2, hubRgb: hubRgb2 } : c));
    addLog(
      `hub → wasm Settled ✓  wasm RGB ${wasmRgb1} → ${wasmRgb2}, hub RGB ${hubRgb1} → ${hubRgb2}`,
      'success'
    );
    await logBalanceSnapshot(wallet, 'after payback');

    setVerdict({
      ok: true,
      detail:
        `Regular channel ✓ — ${REGULAR_PAY_ASSET_AMOUNT} RGB wasm → hub, ` +
        `${REGULAR_PAYBACK_ASSET_AMOUNT} RGB back (wasm RGB ${wasmRgb0} → ${wasmRgb1} → ${wasmRgb2}). ` +
        'Close the channel to settle the split on-chain.',
    });
    setPhase('done');
  }

  // ── Keysend repro (channel_issue.md): hub-initiated keysend into the wasm
  // channel. Expected per the report: the wasm side rejects the counterparty's
  // HTLC signature and force-closes ~0.5s in, while the hub payment sticks at
  // Pending. If it settles instead, the inbound-keysend path has been fixed.
  // Shared by the standalone button (full mode) and the keysend-repro flow,
  // where it fires as the first HTLC on the virgin channel. ───────────────────
  async function keysendReproCore(wallet: UTEXOWallet): Promise<void> {
    addLog('keysend repro: hub-initiated keysend WILL likely force-close the channel', 'info');
    await ensureHubConnected(wallet);
    const before = await readWasmChannel(wallet);
    if (!before?.isUsable) throw new Error('channel not usable — run the flow first');
    const beforeRgb = Number(before.assetLocalAmount ?? 0);

    addLog(
      `→ hub /keysend  asset_amount=${KEYSEND_REPRO_ASSET_AMOUNT} amt_msat=${REGULAR_PAY_MSAT}`
    );
    const ks = await faucetPost<{ payment_hash: string; status: string }>('/keysend', {
      dest_pubkey: wasmPubkeyRef.current,
      amt_msat: REGULAR_PAY_MSAT,
      asset_id: CFG.assetId,
      asset_amount: KEYSEND_REPRO_ASSET_AMOUNT,
    });
    setRepro({
      direction: 'hub→wasm',
      paymentHash: ks.payment_hash,
      status: ks.status ?? 'Pending',
    });
    addLog(`← /keysend  hash=${short(ks.payment_hash)} status=${ks.status}`);

    const deadline = Date.now() + SETTLE_TIMEOUT_S * 1000;
    while (Date.now() < deadline) {
      checkAbort();
      await gatewayFund(addressRef.current, 0.001, 1).catch(() => {});
      await sleep(POLL_INTERVAL_MS);
      const chan = await readWasmChannel(wallet); // drive beat
      const hubChan = await readHubChannel(wasmPubkeyRef.current).catch(() => undefined);
      const pay = await faucetPost<{ payment: { status?: string } }>('/getpayment', {
        payment_hash: ks.payment_hash,
        payment_type: 'Outbound',
      }).catch(() => null);
      const hubStatus = pay?.payment?.status ?? '?';
      setRepro({ direction: 'hub→wasm', paymentHash: ks.payment_hash, status: hubStatus });
      addLog(
        `  hub payment: ${hubStatus}  wasm channel: ${
          chan ? `rgb=${chan.assetLocalAmount ?? '?'}` : 'GONE'
        }  hub channel: ${hubChan ? hubChan.status ?? 'open' : 'GONE'}`
      );

      if (!chan || !hubChan) {
        setReproOutcome({
          kind: 'reproduced',
          detail:
            `Bug REPRODUCED — the channel closed after the hub keysend (hub payment ${hubStatus}). ` +
            'Matches channel_issue.md: wasm side force-closes with "Invalid HTLC tx signature from peer".',
        });
        addLog('bug reproduced: channel force-closed by the wasm side', 'error');
        return;
      }
      if (hubStatus === 'Succeeded') {
        const nowRgb = Number(chan.assetLocalAmount ?? 0);
        setReproOutcome({
          kind: 'settled',
          detail:
            `hub → wasm keysend settled — bug NOT reproduced (wasm RGB ${beforeRgb} → ${nowRgb}). ` +
            'The inbound-keysend path appears fixed.',
        });
        addLog('keysend settled — bug not reproduced', 'success');
        return;
      }
      if (hubStatus === 'Failed') {
        setReproOutcome({
          kind: 'inconclusive',
          detail: 'Hub keysend Failed without a force-close — different failure mode.',
        });
        addLog('hub keysend Failed (no force-close)', 'error');
        return;
      }
    }
    setReproOutcome({
      kind: 'inconclusive',
      detail:
        'Timeout — hub payment still Pending and the channel is still open. ' +
        '(The report has the payment stuck Pending after the close; check the hub log.)',
    });
  }

  const runKeysendRepro = useCallback(async () => {
    const wallet = walletRef.current;
    if (!wallet || !wasmPubkeyRef.current) return;
    setReproRunning(true);
    setRepro(null);
    setReproOutcome(null);
    try {
      await keysendReproCore(wallet);
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      addLog(`keysend repro: ${msg}`, 'error');
      setReproOutcome({ kind: 'inconclusive', detail: msg });
    } finally {
      setReproRunning(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addLog]);

  // ── Keysend wasm → hub: the report's "what does work" direction, on the same
  // channel and with the same amounts as the failing repro — side-by-side
  // evidence that only the inbound (hub-initiated) keysend path is broken. ────
  const runKeysendOut = useCallback(async () => {
    const wallet = walletRef.current;
    if (!wallet || !hubPubkeyRef.current) return;
    setReproRunning(true);
    setRepro(null);
    setReproOutcome(null);
    try {
      await ensureHubConnected(wallet);
      const before = await readWasmChannel(wallet);
      if (!before?.isUsable) throw new Error('channel not usable — run the flow first');
      const beforeRgb = Number(before.assetLocalAmount ?? 0);

      addLog(
        `→ wasm keysend  dest=hub asset_amount=${KEYSEND_REPRO_ASSET_AMOUNT} amt_msat=${REGULAR_PAY_MSAT}`
      );
      const ks = await wallet.keysend(
        hubPubkeyRef.current,
        REGULAR_PAY_MSAT,
        CFG.assetId,
        KEYSEND_REPRO_ASSET_AMOUNT
      );
      setRepro({
        direction: 'wasm→hub',
        paymentHash: ks.paymentHash,
        status: String(ks.status ?? 'Pending'),
      });
      addLog(`← keysend  hash=${short(ks.paymentHash)} status=${ks.status}`);

      const deadline = Date.now() + SETTLE_TIMEOUT_S * 1000;
      while (Date.now() < deadline) {
        checkAbort();
        await gatewayFund(addressRef.current, 0.001, 1).catch(() => {});
        await sleep(POLL_INTERVAL_MS);
        const chan = await readWasmChannel(wallet); // drive beat
        const status = await wallet.getLightningSendRequest(ks.paymentHash);
        setRepro({
          direction: 'wasm→hub',
          paymentHash: ks.paymentHash,
          status: status ?? 'Pending',
        });
        addLog(
          `  wasm keysend: ${status ?? 'Pending'}  channel rgb=${chan?.assetLocalAmount ?? '?'}`
        );
        if (!chan) {
          setReproOutcome({
            kind: 'reproduced',
            detail: 'Unexpected: the channel closed during a wasm → hub keysend.',
          });
          addLog('unexpected channel close during wasm → hub keysend', 'error');
          return;
        }
        if (status === 'Settled') {
          const nowRgb = Number(chan.assetLocalAmount ?? 0);
          const hubChan = await readHubChannel(wasmPubkeyRef.current).catch(() => undefined);
          setReproOutcome({
            kind: 'settled',
            detail:
              `wasm → hub keysend settled ✓ (wasm RGB ${beforeRgb} → ${nowRgb}, ` +
              `hub RGB ${hubChan?.asset_local_amount ?? '?'}) — this direction works; ` +
              'only the hub-initiated keysend force-closes.',
          });
          addLog('wasm → hub keysend settled', 'success');
          return;
        }
        if (status === 'Failed') {
          setReproOutcome({
            kind: 'inconclusive',
            detail: 'wasm → hub keysend Failed — expected it to settle (see log).',
          });
          addLog('wasm → hub keysend Failed', 'error');
          return;
        }
      }
      setReproOutcome({
        kind: 'inconclusive',
        detail: 'Timeout — wasm → hub keysend still Pending.',
      });
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      addLog(`wasm → hub keysend: ${msg}`, 'error');
      setReproOutcome({ kind: 'inconclusive', detail: msg });
    } finally {
      setReproRunning(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addLog]);

  // ── Cooperative close + on-chain settle check: the hub initiates the close
  // (native /closechannel), the wasm side co-signs through the relay session.
  // The channel's final RGB split (asymmetric after the 10-out / 5-back legs)
  // must then appear ON-CHAIN: the wasm wallet — which never held on-chain RGB —
  // should end up with exactly the channel-local amount, the hub gains its
  // remote amount back. Verified via getAssetBalance/listAssets (wasm) and
  // /assetbalance (hub). ──────────────────────────────────────────────────────
  const runCloseChannel = useCallback(async () => {
    const wallet = walletRef.current;
    if (!wallet || !wasmPubkeyRef.current) return;
    setCloseRunning(true);
    setCloseOutcome(null);
    setOnchain(null);
    try {
      await ensureHubConnected(wallet);
      const wasmChan = await readWasmChannel(wallet);
      const hubChan = await readHubChannel(wasmPubkeyRef.current);
      if (!wasmChan?.isUsable || !hubChan?.ready) {
        throw new Error('channel not usable — run the flow first');
      }
      const wasmExpected = Number(wasmChan.assetLocalAmount ?? 0);
      const hubExpectedDelta = Number(hubChan.asset_local_amount ?? 0);
      const hubBefore = await faucetPost<{ spendable?: number }>('/assetbalance', {
        asset_id: CFG.assetId,
      });
      const hubSpendableBefore = Number(hubBefore.spendable ?? 0);
      addLog(
        `closing channel — expected on-chain: wasm +${wasmExpected}, hub +${hubExpectedDelta} ` +
          `(hub spendable before: ${hubSpendableBefore})`
      );

      addLog(`→ hub /closechannel  id=${short(hubChan.channel_id)} (cooperative)`);
      await faucetPost('/closechannel', {
        channel_id: hubChan.channel_id,
        peer_pubkey: wasmPubkeyRef.current,
        force: false,
      });

      // The wasm side co-signs the close over the relay; each listChannels poll
      // also drives the cooperative-close RGB coloring work.
      addLog('waiting for the channel to disappear on both sides…');
      const closeDeadline = Date.now() + CHANNEL_TIMEOUT_S * 1000;
      while (Date.now() < closeDeadline) {
        checkAbort();
        await gatewayFund(addressRef.current, 0.001, 1).catch(() => {});
        await sleep(POLL_INTERVAL_MS);
        const w = await readWasmChannel(wallet);
        const h = await readHubChannel(wasmPubkeyRef.current).catch(() => undefined);
        addLog(`  wasm: ${w ? 'open' : 'gone'}  hub: ${h ? (h.status ?? 'open') : 'gone'}`);
        if (!w && !h) break;
      }

      // Success criterion is the HUB delta: the native side sweeps its close
      // output into its rgb-lib wallet (RgbOutputSpender on SpendableOutputs),
      // proving the split settled on-chain. The wasm-sdk has NO SpendableOutputs
      // handler yet — its share stays colored on the close-tx output, invisible
      // to getAssetBalance — so after the hub settles we only give the wasm
      // side a short grace window before reporting the known gap.
      addLog('waiting for the RGB split to settle on-chain…');
      const settleDeadline = Date.now() + SETTLE_TIMEOUT_S * 1000;
      let wasmBal: { settled?: number; future?: number; spendable?: number } | null = null;
      let hubSpendable = hubSpendableBefore;
      let graceLeft = 5; // extra polls for the wasm side once the hub target is hit
      while (Date.now() < settleDeadline) {
        checkAbort();
        await gatewayFund(addressRef.current, 0.001, 1).catch(() => {});
        await sleep(POLL_INTERVAL_MS);
        await wallet.listChannels().catch(() => {}); // drive beat (close coloring)
        await wallet.syncWallet().catch(() => {});
        await wallet.refreshWallet().catch(() => {});
        wasmBal = await wallet.getAssetBalance(CFG.assetId).catch(() => null);
        await faucetPost('/refreshtransfers', { filter: [], skip_sync: false }).catch(() => {});
        const hb = await faucetPost<{ spendable?: number }>('/assetbalance', {
          asset_id: CFG.assetId,
        }).catch(() => null);
        hubSpendable = Number(hb?.spendable ?? hubSpendable);
        const wasmSettled = Number(wasmBal?.settled ?? 0);
        const wasmFuture = Number(wasmBal?.future ?? 0);
        addLog(
          `  wasm on-chain: settled=${wasmSettled} future=${wasmFuture} spendable=${
            wasmBal?.spendable ?? 0
          }  hub spendable: ${hubSpendable} (was ${hubSpendableBefore})`
        );
        setOnchain({
          wasmSettled,
          wasmSpendable: Number(wasmBal?.spendable ?? 0),
          wasmExpected,
          hubSpendable,
          hubExpectedDelta,
        });
        const wasmOk = wasmSettled >= wasmExpected;
        const hubOk = hubSpendable >= hubSpendableBefore + hubExpectedDelta;
        if (wasmOk && hubOk) break;
        if (hubOk && --graceLeft <= 0) break;
      }

      const assets = await wallet.listAssets().catch(() => null);
      if (assets) addLog(`listAssets: ${JSON.stringify(assets)}`);

      const wasmSettled = Number(wasmBal?.settled ?? 0);
      const hubDelta = hubSpendable - hubSpendableBefore;
      const wasmOk = wasmSettled >= wasmExpected;
      const hubOk = hubDelta >= hubExpectedDelta;
      const kind: CloseOutcome['kind'] = wasmOk && hubOk ? 'settled' : hubOk ? 'partial' : 'incomplete';
      setCloseOutcome({
        kind,
        detail:
          kind === 'settled'
            ? `Close settled on-chain ✓ — wasm ${wasmSettled} RGB (channel-local was ${wasmExpected}), ` +
              `hub +${hubDelta} RGB (channel-local was ${hubExpectedDelta}). ` +
              'The 10-out / 5-back split survived the round trip.'
            : kind === 'partial'
              ? `Hub settled on-chain ✓ (+${hubDelta} RGB, matching its channel-local ${hubExpectedDelta}) — ` +
                `the split was correct. The wasm side's ${wasmExpected} RGB is colored on the close-tx ` +
                'output but the wasm-sdk has no SpendableOutputs/RGB sweep yet, so its wallet ' +
                'balance stays 0 (known gap — funds recoverable once the sweep is implemented).'
              : `On-chain settle incomplete — wasm settled ${wasmSettled}/${wasmExpected}, ` +
                `hub delta ${hubDelta}/${hubExpectedDelta}. May need more blocks/refreshes; check listtransfers.`,
      });
      addLog(
        kind === 'incomplete'
          ? 'close settle incomplete'
          : kind === 'partial'
            ? 'hub settled ✓ — wasm sweep not implemented in wasm-sdk (known gap)'
            : 'channel closed and balances settled on-chain ✓',
        kind === 'incomplete' ? 'error' : 'success'
      );
      if (kind !== 'incomplete') setChannel(null); // channel gone — disable keysend/close
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      addLog(`close channel: ${msg}`, 'error');
      setCloseOutcome({ kind: 'incomplete', detail: msg });
    } finally {
      setCloseRunning(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addLog]);

  const run = useCallback(async () => {
    abortRef.current = false;
    setLog([]);
    setErrorMsg('');
    setChannel(null);
    setPayment(null);
    setVerdict(null);
    setRepro(null);
    setReproOutcome(null);
    setCloseOutcome(null);
    setOnchain(null);
    if (!CFG.assetId) {
      setErrorMsg('VITE_LSP_REGTEST_ASSET_ID not set — run ./scripts/start-lsp-web.sh');
      setPhase('error');
      return;
    }
    if (walletRef.current || tabHasFlowWallet) {
      // One RLN wallet per tab (shared across both flow sections) — a second
      // run would race the first wallet's loops.
      setErrorMsg('This tab already ran a flow — use "Clear wallets & reload" for a fresh run.');
      setPhase('error');
      return;
    }
    try {
      await runFlow();
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      addLog(`Fatal: ${msg}`, 'error');
      setErrorMsg(msg);
      setPhase('error');
    }
    if (walletRef.current) void postFlowFlush(walletRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addLog]);

  // Stop loops + clear UI state. The RLN wallet itself cannot be torn down
  // in-tab — use clearWalletsAndReload() for a truly fresh run.
  const reset = useCallback(() => {
    abortRef.current = true;
    setPhase('idle');
    setLog([]);
    setErrorMsg('');
    setChannel(null);
    setPayment(null);
    setVerdict(null);
    setRepro(null);
    setReproOutcome(null);
    setCloseOutcome(null);
    setOnchain(null);
  }, []);

  const isRunning = !['idle', 'done', 'error'].includes(phase);
  const busy = isRunning || reproRunning || closeRunning;
  return {
    phase,
    log,
    errorMsg,
    run,
    reset,
    channel,
    payment,
    verdict,
    runKeysendRepro,
    runKeysendOut,
    repro,
    reproOutcome,
    reproRunning,
    runCloseChannel,
    closeRunning,
    closeOutcome,
    onchain,
    /** Keysend/close need a usable channel from a completed flow run in this tab. */
    canRepro: !!channel && phase === 'done' && !busy,
    envReady: !!CFG.assetId,
    isRunning,
  };
}
