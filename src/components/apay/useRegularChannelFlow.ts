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
import { DEMO_VSS_URL, mineBlocks } from '../../lib/utils';
import {
  CFG,
  CHANNEL_TIMEOUT_S,
  FAUCET_LDK_PORT,
  FUNDING_BROADCAST_TIMEOUT_S,
  FUNDING_CAPACITY_SAT,
  FUNDING_READY_TIMEOUT_S,
  KEYSEND_REPRO_ASSET_AMOUNT,
  POLL_INTERVAL_MS,
  REGULAR_LDK_PORT,
  REGULAR_PUBKEY,
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
  indexerBroadcast,
  indexerTxSeen,
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

/**
 * Outcome of the wallet-funded open repro (§6.0s).
 *
 * The three middle kinds are the whole point: when the channel does not become
 * ready, they say *which* half is at fault instead of leaving it open.
 *   - `broadcast_broken` — esplora accepted the hex the SDK failed to publish
 *   - `tx_invalid`       — esplora rejected it too; the tx itself is wrong
 *   - `stalled`          — tx is in the mempool, channel still never locks in
 */
export interface FundingOutcome {
  kind: 'ready' | 'broadcast_broken' | 'tx_invalid' | 'stalled' | 'inconclusive';
  detail: string;
}

/** What the wallet-funded open produced, step by step. */
export interface FundingInfo {
  temporaryChannelId: string;
  counterpartyNodeId: string;
  channelValueSat: number;
  txid: string;
  /** Did the indexer see the tx from the SDK's own broadcast path? */
  sdkBroadcast: boolean | null;
  /** Verbatim esplora reply to the independent POST /tx, when we had to probe. */
  probe?: string;
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
  const [funding, setFunding] = useState<FundingInfo | null>(null);
  const [fundingOutcome, setFundingOutcome] = useState<FundingOutcome | null>(null);
  const [fundingRunning, setFundingRunning] = useState(false);

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

  // Same shape as ensureHubConnected, and for the same reason: dialling a peer
  // that is already connected does not no-op, it hangs until the handshake
  // times out. A second funding run in one session hits exactly that.
  async function ensureRegularConnected(wallet: UTEXOWallet, attempts = 4) {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      checkAbort();
      try {
        const peers = await wallet.listPeers().catch(() => []);
        if (peers.some((p) => p.pubkey === REGULAR_PUBKEY && p.isConnected !== false)) {
          addLog('  regular_web already connected — reusing the session');
          return;
        }
        await wallet.connectPeer(`${REGULAR_PUBKEY}@127.0.0.1:${REGULAR_LDK_PORT}`);
        return;
      } catch (e) {
        lastErr = e;
        addLog(`  regular_web connect attempt ${i + 1}/${attempts}: ${e}`);
        await sleep(2000);
      }
    }
    throw new Error(
      `could not connect to regular_web after ${attempts} attempts: ${lastErr}`
    );
  }

  // Minimal wallet for the cold-start funding test: create, fund, sync, stop.
  // Intentionally NOT what runFlow() does — no createUtxos, no channel, no
  // payments — so the only difference from a warm run is how much the BDK
  // wallet has done before input selection.
  async function bootstrapColdWallet(): Promise<UTEXOWallet> {
    const mnemonic = await stableMnemonic();
    const fresh = Date.now().toString(16);
    addLog(`→ create wallet (cold)  network=regtest dataDir=/funding_${fresh}`);
    const wallet = new UTEXOWallet({
      network: 'regtest',
      mnemonic,
      password: 'apay-regular',
      proxyUrl: CFG.gatewayWs,
      transportEndpoint: CFG.transport,
      indexerUrl: CFG.indexer,
      skipConsistencyCheck: true,
      dataDir: `/funding_${fresh}`,
      nodeRuntimeId: `funding-${fresh}`,
      vssUrl: DEMO_VSS_URL,
    });
    await wallet.init();
    await wallet.unlock();
    walletRef.current = wallet;
    tabHasFlowWallet = true;
    if (!wallet.isOnline())
      throw new Error(`indexer unreachable at ${CFG.indexer} — is the LSP web stack running?`);
    const address = await wallet.getAddress();
    addressRef.current = address;
    addLog(`← wallet ready  address=${short(address)}`, 'success');

    addLog('→ gatewayFund  btc=1 mine=6');
    await gatewayFund(address, 1, 6);
    for (let i = 0; i < 20; i++) {
      checkAbort();
      await wallet.syncWallet();
      const b = (await wallet.getBtcBalance()) as { vanilla?: { spendable?: number } };
      if ((b?.vanilla?.spendable ?? 0) > 0) break;
      await sleep(2000);
    }
    addLog('← funded (cold — no createUtxos, no payments)', 'success');
    return wallet;
  }

  // Wait for THIS funding tx's channel to lock in. Mining a block each pass is
  // what confirms it; listChannels is the drive beat — the wasm node has no
  // background executor, so a run that stops polling stops the channel dead
  // even after the funding tx has plenty of confirmations.
  //
  // mineBlocks, not gatewayFund: this flow's whole subject is which UTXOs BDK
  // picked, so it must not be paying the wallet while it waits. mineBlocks
  // generates to bitcoind's own address and leaves the wallet untouched.
  //
  // Matching on fundingTxid, not peerPubkey: a second run in the same session
  // opens a SECOND channel to the same peer, and a pubkey match would latch
  // onto the first run's already-ready channel and report success in one poll
  // — while the channel it actually opened never gets driven to ready.
  async function waitFundedChannelReady(wallet: UTEXOWallet, fundingTxid: string) {
    const deadline = Date.now() + FUNDING_READY_TIMEOUT_S * 1000;
    while (Date.now() < deadline) {
      checkAbort();
      await mineBlocks(1).catch(() => {});
      await sleep(POLL_INTERVAL_MS);
      const channels = await wallet.listChannels().catch(() => []);
      const chan = channels.find(
        (c) => c.fundingTxid === fundingTxid || (!c.fundingTxid && c.peerPubkey === REGULAR_PUBKEY)
      );
      // Full listChannels each pass, not just the matched row: with several
      // channels to the same peer the interesting question is usually which of
      // them moved, and a one-line summary hides exactly that.
      addLog(
        `  listChannels (${channels.length}): ` +
          (channels
            .map(
              (c) =>
                `${short(c.fundingTxid ?? c.channelId, 10)}${
                  c.fundingTxid === fundingTxid ? '*' : ''
                }=${c.ready ? 'ready' : 'pending'}${c.isUsable ? '/usable' : ''}` +
                `${c.assetId ? `/rgb${c.assetLocalAmount ?? 0}` : ''}`
            )
            .join('  ') || '(none)')
      );
      addLog(
        `  channel ${short(fundingTxid, 12)}: ${
          chan ? (chan.ready ? 'ready' : 'pending') : 'absent'
        }`
      );
      if (chan?.ready) return chan;
    }
    return undefined;
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
        await wallet.connectPeer(`${hubPubkeyRef.current}@127.0.0.1:${FAUCET_LDK_PORT}`);
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
      vssUrl: DEMO_VSS_URL,
    });
    await wallet.init();
    await wallet.unlock();
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

    // getLightningSendStatus polls getPayment — each call is also a drive beat.
    const sendDeadline = Date.now() + SETTLE_TIMEOUT_S * 1000;
    let sendStatus: string | null = 'WaitingCounterparty';
    while (Date.now() < sendDeadline) {
      checkAbort();
      await gatewayFund(address, 0.001, 1).catch(() => {});
      await sleep(POLL_INTERVAL_MS);
      sendStatus = await wallet.getLightningSendStatus(sent.txid);
      setPayment({
        direction: 'wasm→hub',
        paymentHash: sent.txid,
        status: sendStatus ?? 'Pending',
      });
      addLog(`  wasm → hub: ${sendStatus ?? 'Pending'}`);
      if (sendStatus === 'Succeeded' || sendStatus === 'Failed') break;
    }
    if (sendStatus !== 'Succeeded') {
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
      recvStatus = await wallet.getLightningReceiveStatus(lnInvoice);
      setPayment({
        direction: 'hub→wasm',
        paymentHash: hubSent.payment_hash,
        status: recvStatus ?? 'Pending',
      });
      addLog(`  hub → wasm: ${recvStatus ?? 'Pending'}`);
      if (recvStatus === 'Succeeded' || recvStatus === 'Failed') break;
    }
    if (recvStatus !== 'Succeeded') {
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
        const status = await wallet.getLightningSendStatus(ks.paymentHash);
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
        if (status === 'Succeeded') {
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

  // ── Wallet-funded open (§6.0s repro) ────────────────────────────────────────
  // Every other flow here has the NATIVE side open the channel, so the native
  // node builds and broadcasts the funding tx and the browser never funds
  // anything. This one inverts that: the wasm node opens, and the app must fund
  // it itself —
  //
  //   openChannel → listPendingFundingRequests → buildLightningFundingTx
  //               → submitFundingTransaction → (broadcast) → channel_ready
  //
  // The peer is `regular_web`, NOT the hub: both hub daemons run with
  // --enable-virtual-channels-v0 and reject a wasm-initiated open with
  // `unsupported_scid_alias` (§6.0r).
  //
  // The known failure is that the channel stalls at "pending awaiting funding
  // lock-in" because the funding tx never reaches the mempool. Rather than just
  // reproducing that, this flow BISECTS it: when the indexer has not seen the
  // tx, it POSTs the very same hex to esplora directly, bypassing the SDK. That
  // single answer splits the two candidate causes apart — see FundingOutcome.
  const runWalletFundedOpen = useCallback(async () => {
    setFundingRunning(true);
    setFunding(null);
    setFundingOutcome(null);
    const prevPhase = phase;
    setPhase('rc_funding');
    try {
      if (!REGULAR_PUBKEY) {
        throw new Error(
          'VITE_REGULAR_PEER_PUBKEY is unset — re-run scripts/start-lsp-web.sh to ' +
            'write it into .env.local (the regular_web daemon must be up).'
        );
      }

      // Cold start. Running this button without the main flow first is the
      // actual experiment for §6.0s: the warm path reaches openChannel with a
      // BDK view that has just been synced and pushed through four payments,
      // and the stale-view input-selection theory (§6.0l) predicts only the
      // warm path succeeds. So bootstrap the bare minimum — create, fund, sync —
      // and deliberately skip createUtxos and every payment leg.
      const wallet = walletRef.current ?? (await bootstrapColdWallet());
      const address = addressRef.current;

      // 1. Dial regular_web through the gateway relay (outbound-only, so the
      //    browser must connect first — same constraint as the hub).
      addLog(`→ connectPeer  regular_web ${short(REGULAR_PUBKEY)}@:${REGULAR_LDK_PORT}`);
      await ensureRegularConnected(wallet);

      // 2. Open AND fund, in one call. The SDK owns the whole handshake now
      //    (openChannel → listPendingFundingRequests → buildLightningFundingTx
      //    → submitFundingTransaction), so this repro measures what an app
      //    actually calls rather than a sequence only this file performed.
      //
      //    BTC-only: whether the funding tx reaches the mempool has nothing to
      //    do with the asset leg, and omitting it removes a variable. The fee
      //    rate comes from the wallet's feeRateSatVb, mirroring the native
      //    daemon's [rgb] fee_rate_sat_vb.
      //
      //    No mining anywhere in here: FundingGenerationReady is a peer
      //    protocol event, and the wallet must not receive fresh UTXOs in the
      //    moments before BDK selects its inputs — that would perturb exactly
      //    what §6.0l suspects. Mine only where confirmations are genuinely
      //    awaited, i.e. waitFundedChannelReady.
      addLog(`→ openChannel  capacity=${FUNDING_CAPACITY_SAT} sat (no asset, funds itself)`);
      const opened = await wallet.openChannel({
        peerPubkey: REGULAR_PUBKEY,
        capacitySat: FUNDING_CAPACITY_SAT,
        isPublic: false,
      });
      const txid = opened.fundingTxid ?? '';
      const fundingTxHex = opened.fundingTxHex ?? '';
      if (!txid || !fundingTxHex) {
        throw new Error('openChannel returned no funding tx — the channel is open but unfunded');
      }
      addLog(
        `← temporaryChannelId ${short(opened.temporaryChannelId, 32)}  ` +
          `funding txid=${short(txid)}  ${fundingTxHex.length / 2} bytes`
      );
      setFunding({
        temporaryChannelId: opened.temporaryChannelId,
        counterpartyNodeId: REGULAR_PUBKEY,
        channelValueSat: FUNDING_CAPACITY_SAT,
        txid,
        sdkBroadcast: null,
      });

      // 6. Did the SDK's broadcast path actually publish it?
      let seen = false;
      const bcDeadline = Date.now() + FUNDING_BROADCAST_TIMEOUT_S * 1000;
      while (Date.now() < bcDeadline) {
        checkAbort();
        await wallet.listChannels().catch(() => []); // drive beat
        await mineBlocks(1).catch(() => {}); // mine-only — never pay the wallet mid-flow
        const at = await indexerTxSeen(txid);
        if (at) {
          seen = true;
          addLog(`  indexer: funding tx present (${at.confirmed ? 'confirmed' : 'mempool'})`);
          break;
        }
        addLog('  indexer: funding tx not seen yet');
        await sleep(POLL_INTERVAL_MS);
      }
      setFunding((f) => (f ? { ...f, sdkBroadcast: seen } : f));

      // 7. THE BISECT. The SDK did not publish it — try esplora directly with
      //    the identical hex. Whatever esplora says settles which half is broken.
      if (!seen) {
        addLog(`indexer never saw ${short(txid)} — probing esplora directly`, 'error');
        const probe = await indexerBroadcast(fundingTxHex);
        setFunding((f) => (f ? { ...f, probe: probe.body } : f));
        addLog(`← POST /tx  ${probe.accepted ? 'ACCEPTED' : 'REJECTED'}: ${probe.body || '(empty)'}`);

        if (!probe.accepted) {
          setFundingOutcome({
            kind: 'tx_invalid',
            detail:
              'esplora rejected the same hex, so the SDK broadcast path is innocent — the ' +
              `funding transaction itself is invalid. Most likely stale-view input selection ` +
              `(§6.0l), which also explains why the one passing run was on a freshly ` +
              `provisioned chain. esplora said: ${probe.body || '(empty response)'}`,
          });
          addLog('funding tx is invalid — not a broadcast problem', 'error');
          return;
        }

        // Accepted out-of-band: the tx was always fine. Keep going, because
        // whether the channel now locks in tells us if out-of-band broadcast is
        // a complete fix or only half of one.
        addLog('esplora accepted it — the tx was valid all along; SDK broadcast is the bug', 'error');
        const ready = await waitFundedChannelReady(wallet, txid);
        setFundingOutcome({
          kind: 'broadcast_broken',
          detail:
            'The SDK never published the funding tx, but esplora accepted the identical hex ' +
            'on a direct POST — so the transaction was always valid and the broken half is ' +
            'our broadcast path (chainSyncEnqueueRebroadcastTx never flushes). ' +
            (ready
              ? 'After the out-of-band broadcast the channel became ready, so broadcasting ' +
                'out-of-band is a complete fix — which is what upstream’s flow.js does.'
              : 'The channel still did NOT become ready afterwards, so broadcast is not the ' +
                'only problem — something downstream of lock-in is also wrong.'),
        });
        return;
      }

      // 8. The tx was published by the SDK. Does the channel lock in?
      addLog('indexer saw the funding tx ✓ — waiting for channel_ready');
      const ready = await waitFundedChannelReady(wallet, txid);
      if (ready) {
        setFundingOutcome({
          kind: 'ready',
          detail:
            `Wallet-funded channel is ready ✓ — capacity ${ready.capacitySat} sat against ` +
            'regular_web. The SDK broadcast the funding tx itself; scenario I passed this run.',
        });
        addLog('wallet-funded channel ready ✓', 'success');
      } else {
        setFundingOutcome({
          kind: 'stalled',
          detail:
            'The funding tx IS in the indexer, yet the channel never became ready — it is ' +
            'stuck at "pending awaiting funding lock-in". Broadcast is not the problem this ' +
            'run; check the peer log on regular_web for what it did with FundingSigned.',
        });
        addLog('funding tx published but channel never locked in', 'error');
      }
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      addLog(`wallet-funded open: ${msg}`, 'error');
      setFundingOutcome({ kind: 'inconclusive', detail: msg });
    } finally {
      setFundingRunning(false);
      setPhase(prevPhase === 'idle' ? 'done' : prevPhase);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addLog, phase]);

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

      // BOTH sides must now settle on-chain. The native side has always swept
      // its close output (RgbOutputSpender on SpendableOutputs); the wasm side
      // gained the same pipeline in rgb-lightning-node PR #119 ("Settle
      // on-chain RGB and BTC on the wasm side after channel close"), so its
      // share reaching getAssetBalance is a real expectation rather than the
      // known gap it used to be — hence no grace window, and no 'partial' as a
      // success shape.
      //
      // Two things the wasm side needs and the hub does not:
      //   - blocks, and plenty. The closing tx must mature past ANTI_REORG_DELAY
      //     (6) before SpendableOutputs fires, then the sweep tx needs its own
      //     confirmations. Mining 2 per poll matches upstream's own flow.
      //   - `future`, not `settled`. The three Balance fields are views of one
      //     total, not components of it (on a quiet wallet all three are equal,
      //     so summing two double-counts). `future` is the view that includes
      //     pending inflows — which is what a freshly swept close output is
      //     until it confirms.
      addLog('waiting for the RGB split to settle on-chain (both sides)…');
      const settleDeadline = Date.now() + SETTLE_TIMEOUT_S * 1000;
      let wasmBal: { settled?: number; future?: number; spendable?: number } | null = null;
      let hubSpendable = hubSpendableBefore;
      while (Date.now() < settleDeadline) {
        checkAbort();
        await mineBlocks(2).catch(() => {});
        await sleep(POLL_INTERVAL_MS);
        await wallet.listChannels().catch(() => {}); // drive beat (close coloring + sweep)
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
        const wasmOk = wasmFuture >= wasmExpected;
        const hubOk = hubSpendable >= hubSpendableBefore + hubExpectedDelta;
        if (wasmOk && hubOk) break;
      }

      const assets = await wallet.listAssets().catch(() => null);
      if (assets) addLog(`listAssets: ${JSON.stringify(assets)}`);

      const wasmSettled = Number(wasmBal?.settled ?? 0);
      const wasmFuture = Number(wasmBal?.future ?? 0);
      const wasmTotal = wasmFuture;
      const hubDelta = hubSpendable - hubSpendableBefore;
      const wasmOk = wasmTotal >= wasmExpected;
      const hubOk = hubDelta >= hubExpectedDelta;
      const kind: CloseOutcome['kind'] = wasmOk && hubOk ? 'settled' : hubOk ? 'partial' : 'incomplete';
      setCloseOutcome({
        kind,
        detail:
          kind === 'settled'
            ? `Close settled on-chain ✓ — wasm ${wasmTotal} RGB (future; settled ${wasmSettled}; ` +
              `channel-local was ${wasmExpected}), hub +${hubDelta} RGB ` +
              `(channel-local was ${hubExpectedDelta}). The 10-out / 5-back split survived the ` +
              'round trip, and the wasm side swept its own close output.'
            : kind === 'partial'
              ? `Only the hub settled (+${hubDelta} RGB, matching its channel-local ${hubExpectedDelta}) — ` +
                `the split was correct, but the wasm side recovered ${wasmTotal}/${wasmExpected}. ` +
                'With the post-close sweep in place (rgb-lightning-node #119) this is a FAILURE, ' +
                'not the old known gap: check that the sweep tx was broadcast and confirmed, and ' +
                'that the closing tx matured past ANTI_REORG_DELAY (6 blocks).'
              : `On-chain settle incomplete — wasm ${wasmTotal}/${wasmExpected}, ` +
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
    setFunding(null);
    setFundingOutcome(null);
  }, []);

  const isRunning = !['idle', 'done', 'error'].includes(phase);
  const busy = isRunning || reproRunning || closeRunning || fundingRunning;
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
    runWalletFundedOpen,
    funding,
    fundingOutcome,
    fundingRunning,
    /** Keysend/close need a usable channel from a completed flow run in this tab. */
    canRepro: !!channel && phase === 'done' && !busy,
    /**
     * Runnable with or without the main flow: it opens its own channel to a
     * different peer, and bootstraps its own wallet when none exists. Running it
     * cold — first click in a fresh tab — is the §6.0s experiment.
     */
    canFund: !busy && !!REGULAR_PUBKEY,
    /** True once a wallet exists, i.e. the next funding run will be a warm one. */
    fundWarm: !!walletRef.current,
    envReady: !!CFG.assetId,
    isRunning,
  };
}
