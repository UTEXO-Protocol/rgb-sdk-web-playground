// APay Cart Checkout orchestration — web port of
// rgb-sdk-rn-demo/screens/apay/useApayFlow.ts (cart variant), split by role:
// one RLN wallet per browser window (Run 1 = Merchant, Run 2 = Buyer),
// coordinated over BroadcastChannel like RegtestLspFlow.
//
// Merchant window:  b_init → b_fund → b_utxos → b_channel → register → watch
//   register = lsp.connect() + enableLightningAddress(); then keepalive
//   (lsp.connect every 15s + hash-pool auto-refill) and the settle watcher
//   (buyer's payment hash arrives over BroadcastChannel; verify via
//   listChannels assetLocalAmount delta + listPaymentsRaw — NOT
//   getAssetBalance, the wasm wallet db doesn't know channel-pushed RGB).
// Buyer window:     a_init → a_fund → a_utxos → a_channel → a_topup → send → settle
//   a_topup = RN parity: lsp.receiveAsset → faucet on-chain RGB send (via the
//   gateway /dev/regular-rln proxy) → awaitReceiveSettlement.
// Merchant never calls claimHodlInvoice — the LSP outbox delivers.
import { useCallback, useEffect, useRef, useState } from 'react';
import { UTEXOWallet, generateKeys, type UtexoLsp } from '@utexo/rgb-sdk-web';
import { useStore } from '../../store';
import {
  APAY_HASH_REFILL_THRESHOLD,
  BC_NAME,
  CFG,
  CHANNEL_TIMEOUT_S,
  LNADDRESS_REBROADCAST_MS,
  MERCHANT_KEEPALIVE_MS,
  PAYMENT_ASSET_AMOUNT,
  PAYMENT_MSAT,
  POLL_INTERVAL_MS,
  SETTLE_TIMEOUT_S,
  faucetPost,
  gatewayFund,
  normHash,
  short,
  sleep,
  type ApayBcMessage,
  type LogEntry,
  type Phase,
  type Role,
} from './config';

export interface ChannelInfo {
  capacitySat: number;
  outboundBalanceMsat: number;
}

export interface CheckoutVerdict {
  ok: boolean;
  soft?: boolean;
  detail: string;
}

// Stable mnemonic per role — re-running the same role reuses it, so gateway
// funding hits the same keys across retries (RegtestLspFlow pattern).
async function roleMnemonic(role: Role): Promise<string> {
  const key = `apay-flow-mnemonic-${role}`;
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
    setTimeout(resolve, 3000);
  });
}

// One RLN wallet per tab; the demo auto-restores saved wallets on load, so the
// flow needs a clean tab. Wipes localStorage sessions + IndexedDB, then reloads.
export async function clearWalletsAndReload() {
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

type PaymentRow = Record<string, unknown>;
const rowField = <T,>(p: PaymentRow, camel: string, snake: string) =>
  (p[camel] ?? p[snake]) as T | undefined;

export function useApayFlow(role: Role) {
  const addStoreLog = useStore((s) => s.addLog);

  const [phase, setPhase] = useState<Phase>('idle');
  const [log, setLog] = useState<LogEntry[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [lightningAddress, setLightningAddress] = useState('');
  const [unusedHashes, setUnusedHashes] = useState<number | null>(null);
  const [channel, setChannel] = useState<ChannelInfo | null>(null);
  const [hodlBolt11, setHodlBolt11] = useState('');
  const [paymentHash, setPaymentHash] = useState('');
  const [sendStatus, setSendStatus] = useState('');
  const [otherStatus, setOtherStatus] = useState('');
  const [localRgb, setLocalRgb] = useState<number | null>(null);
  const [checkout, setCheckout] = useState<CheckoutVerdict | null>(null);

  const walletRef = useRef<UTEXOWallet | null>(null);
  const lspRef = useRef<UtexoLsp | null>(null);
  const bcRef = useRef<BroadcastChannel | null>(null);
  const abortRef = useRef(false);
  const addressRef = useRef('');
  const rebroadcastRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unusedHashesRef = useRef<number | null>(null);
  const baselineRgbRef = useRef(0);
  // Merchant settle watcher state — fed by buyer 'payment' messages.
  const watchingHashRef = useRef('');
  const watchDeadlineRef = useRef(0);
  const buyerSettledRef = useRef(false);

  const addLog = useCallback(
    (msg: string, type: LogEntry['type'] = 'info') => {
      const time = new Date().toLocaleTimeString('en', { hour12: false });
      setLog((prev) => [...prev.slice(-500), { time, msg, type }]);
      addStoreLog(
        `[apay:${role}] ${msg}`,
        type === 'success' ? 'ok' : type === 'error' ? 'err' : 'info'
      );
    },
    [addStoreLog, role]
  );

  const post = useCallback((m: ApayBcMessage) => bcRef.current?.postMessage(m), []);

  const setAddress = useCallback((a: string) => {
    addressRef.current = a;
    setLightningAddress(a);
  }, []);

  // Cross-window coordination (plan §3): merchant publishes its Lightning
  // Address + status; buyer publishes payment hash/status; merchant answers
  // with the settlement verdict.
  useEffect(() => {
    const bc = new BroadcastChannel(BC_NAME);
    bcRef.current = bc;
    bc.onmessage = (e: MessageEvent<ApayBcMessage>) => {
      const m = e.data;
      if (!m || typeof m !== 'object') return;
      if (m.type === 'lnaddress' && role === 'buyer') {
        if (m.address !== addressRef.current) {
          setAddress(m.address);
          addLog(`Lightning Address received from Merchant window: ${m.address}`, 'success');
        }
      } else if (m.type === 'merchant_status' && role === 'buyer') {
        setOtherStatus(
          `merchant ${m.phase}${m.localRgb != null ? ` (channel RGB ${m.localRgb})` : ''}`
        );
      } else if (m.type === 'payment' && role === 'merchant') {
        if (watchingHashRef.current !== m.paymentHash) {
          watchingHashRef.current = m.paymentHash;
          watchDeadlineRef.current = Date.now() + SETTLE_TIMEOUT_S * 1000;
          buyerSettledRef.current = false;
          addLog(`buyer payment hash received: ${short(m.paymentHash)} — watching settlement`);
        }
        if (m.status === 'Settled') buyerSettledRef.current = true;
        setOtherStatus(`buyer payment: ${m.status}`);
      } else if (m.type === 'verdict' && role === 'buyer') {
        setCheckout({ ok: m.ok, soft: m.soft, detail: m.detail });
        addLog(`merchant verdict: ${m.detail}`, m.ok ? 'success' : m.soft ? 'info' : 'error');
      }
    };
    return () => {
      bc.close();
      abortRef.current = true;
      if (rebroadcastRef.current) clearInterval(rebroadcastRef.current);
    };
  }, [role, addLog, setAddress]);

  const req = useCallback(
    (label: string, p?: Record<string, unknown>) =>
      addLog(
        `→ ${label}${p ? '  ' + Object.entries(p).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ') : ''}`
      ),
    [addLog]
  );
  const res = useCallback(
    (label: string, d?: Record<string, unknown>) =>
      addLog(
        `← ${label}${d ? '  ' + Object.entries(d).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ') : ''}`,
        'success'
      ),
    [addLog]
  );

  const checkAbort = () => {
    if (abortRef.current) throw new Error('Cancelled');
  };

  // Virtual channels drop the LSP's TCP session right after open (known RN
  // quirk: "virtual channels may drop TCP") — in wasm a connect() racing the
  // dying session times out on the handshake while the *next* session
  // succeeds. Skip if already connected, retry instead of dying.
  async function ensureConnected(wallet: UTEXOWallet, lsp: UtexoLsp, attempts = 4) {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      checkAbort();
      try {
        const peers = await wallet.listPeers().catch(() => []);
        if (peers.some((p) => p.pubkey === CFG.lspPubkey && p.isConnected !== false)) return;
        await lsp.connect();
        return;
      } catch (e) {
        lastErr = e;
        addLog(`  lsp.connect attempt ${i + 1}/${attempts}: ${e}`);
        await sleep(2000);
      }
    }
    throw new Error(`could not connect to the LSP peer after ${attempts} attempts: ${lastErr}`);
  }

  // Channel RGB lives in the LDK layer (assetLocalAmount), not the on-chain
  // rgb-lib db — this is the only reliable balance read for channel-pushed RGB.
  async function readLspChannelRgb(wallet: UTEXOWallet): Promise<number> {
    const channels = await wallet.listChannels();
    const chan = channels.find(
      (c) => c.assetId === CFG.assetId && c.peerPubkey === CFG.lspPubkey
    );
    return Number(chan?.assetLocalAmount ?? 0);
  }

  // ── Shared setup: wallet → online → fund → utxos → LSP channel (§2 steps 1–5,
  // identical for both roles; proven verbatim in RegtestLspFlow) ──────────────
  async function setup(): Promise<{ wallet: UTEXOWallet; lsp: UtexoLsp; address: string }> {
    setPhase(role === 'merchant' ? 'b_init' : 'a_init');
    const mnemonic = await roleMnemonic(role);
    // Fresh dataDir + nodeRuntimeId per run → full chain scan instead of a
    // stale checkpoint; mnemonic stays stable so funding hits the same keys.
    const fresh = Date.now().toString(16);
    req(`${role}.create`, { network: 'regtest', dataDir: `/apay_${role}_${fresh}` });
    const wallet = await UTEXOWallet.create({
      network: 'regtest',
      mnemonic,
      password: `apay-${role}`,
      proxyUrl: CFG.gatewayWs,
      transportEndpoint: CFG.transport,
      indexerUrl: CFG.indexer,
      skipConsistencyCheck: true,
      lspBaseUrl: CFG.lspBaseUrl,
      dataDir: `/apay_${role}_${fresh}`,
      nodeRuntimeId: `apay-${role}-${fresh}`,
    });
    walletRef.current = wallet;
    if (!wallet.isOnline())
      throw new Error(`indexer unreachable at ${CFG.indexer} — is the LSP web stack running?`);
    const address = await wallet.getAddress();
    res(`${role}.create`, { address: short(address) });

    setPhase(role === 'merchant' ? 'b_fund' : 'a_fund');
    req('gatewayFund', { btc: 1, mine: 6 });
    await gatewayFund(address, 1, 6);
    for (let i = 0; i < 20; i++) {
      checkAbort();
      await wallet.syncWallet();
      const b = (await wallet.getBtcBalance()) as { vanilla?: { spendable?: number } };
      if ((b?.vanilla?.spendable ?? 0) > 0) break;
      await sleep(2000);
    }
    res(`${role}.funded`);

    setPhase(role === 'merchant' ? 'b_utxos' : 'a_utxos');
    req(`${role}.createUtxos`);
    await wallet.createUtxos({ upTo: false, num: 10, feeRate: 7 });
    await gatewayFund(address, 0.001, 1);
    await wallet.syncWallet();
    res(`${role}.createUtxos`);

    addLog('attaching LN node…');
    wallet.attachLightningNode();

    setPhase(role === 'merchant' ? 'b_channel' : 'a_channel');
    const lsp = await wallet.createLsp({
      baseUrl: CFG.lspBaseUrl,
      peerPubkey: CFG.lspPubkey,
      peerHost: '127.0.0.1',
      peerPort: CFG.lspPort,
    });
    lspRef.current = lsp;
    req('lsp.connect');
    await lsp.connect();
    res('lsp.connect');

    addLog(`waiting for RGB channel usable (asset ${short(CFG.assetId)})…`);
    const chan = await lsp.waitForChannel(CFG.assetId, {
      timeoutMs: CHANNEL_TIMEOUT_S * 1000,
      pollIntervalMs: POLL_INTERVAL_MS,
      onProgress: (m) => addLog(`  ${role} ${m}`),
      onEachPoll: () => gatewayFund(address, 0.001, 1).catch(() => {}),
    });
    setChannel({ capacitySat: chan.capacitySat, outboundBalanceMsat: chan.outboundBalanceMsat });
    addLog(
      `RGB channel usable ✓ cap=${chan.capacitySat} sat outbound=${chan.outboundBalanceMsat} msat`,
      'success'
    );
    return { wallet, lsp, address };
  }

  // ── Merchant: register Lightning Address, then keepalive + settle watcher ───
  async function runMerchant() {
    const { wallet, lsp, address } = await setup();

    baselineRgbRef.current = await readLspChannelRgb(wallet);
    setLocalRgb(baselineRgbRef.current);
    addLog(`channel RGB baseline: ${baselineRgbRef.current}`);

    setPhase('register');
    req('lsp.connect'); // re-connect before P2P apay (virtual channels may drop TCP)
    await ensureConnected(wallet, lsp);
    res('lsp.connect');
    await sleep(1000);

    req('lsp.enableLightningAddress');
    const lnAddr = await lsp.enableLightningAddress();
    setAddress(lnAddr.address);
    unusedHashesRef.current = lnAddr.unusedHashes ?? null;
    setUnusedHashes(lnAddr.unusedHashes ?? null);
    res('enableLightningAddress', { address: lnAddr.address, unusedHashes: lnAddr.unusedHashes });

    post({ type: 'lnaddress', address: lnAddr.address });
    rebroadcastRef.current = setInterval(() => {
      if (addressRef.current) post({ type: 'lnaddress', address: addressRef.current });
    }, LNADDRESS_REBROADCAST_MS);
    addLog(`Lightning Address published to the Buyer window: ${lnAddr.address}`, 'success');

    // Keepalive + settle watcher — the merchant window stays running: it must
    // remain reachable for the LSP outbox (request_outbound_invoice).
    setPhase('watch');
    addLog('keepalive: lsp.connect() every 15s + hash-pool auto-refill; waiting for a buyer payment…');
    let sinceKeepalive = MERCHANT_KEEPALIVE_MS; // connect immediately on first tick
    let lastRgb = baselineRgbRef.current;
    const declareSuccess = (detail: string, nowRgb: number) => {
      addLog(`${detail} ✓`, 'success');
      setCheckout({ ok: true, detail });
      post({ type: 'verdict', ok: true, detail });
      // One hash served this payment — let auto-refill see the drop.
      if (unusedHashesRef.current !== null) {
        unusedHashesRef.current = Math.max(0, unusedHashesRef.current - 1);
        setUnusedHashes(unusedHashesRef.current);
      }
      baselineRgbRef.current = nowRgb; // rearm for a follow-up payment
      watchingHashRef.current = '';
      setPhase('done');
    };
    while (!abortRef.current) {
      await sleep(POLL_INTERVAL_MS);
      if (abortRef.current) break;

      sinceKeepalive += POLL_INTERVAL_MS;
      if (sinceKeepalive >= MERCHANT_KEEPALIVE_MS) {
        sinceKeepalive = 0;
        try {
          await ensureConnected(wallet, lsp, 2);
        } catch {
          /* retried; next keepalive tick tries again */
        }
        const left = unusedHashesRef.current;
        if (left !== null && left < APAY_HASH_REFILL_THRESHOLD) {
          try {
            const pool = await lsp.refillHashPool();
            unusedHashesRef.current = pool.unusedHashes;
            setUnusedHashes(pool.unusedHashes);
            addLog(`auto-refill: unusedHashes ${left} → ${pool.unusedHashes}`, 'success');
          } catch (e) {
            addLog(`auto-refill failed: ${e}`, 'error');
          }
        }
        // Self-sufficient delivery check: the LSP outbox pays us whether or not
        // the buyer's BroadcastChannel message arrived (missed messages,
        // backgrounded window) — detect the channel RGB delta directly.
        try {
          await wallet.syncWallet();
          const nowRgb = await readLspChannelRgb(wallet);
          lastRgb = nowRgb;
          setLocalRgb(nowRgb);
          const delta = nowRgb - baselineRgbRef.current;
          if (delta > 0 && !watchingHashRef.current) {
            declareSuccess(`merchant received +${delta} RGB on the LSP channel (LSP outbox)`, nowRgb);
          }
        } catch (e) {
          addLog(`keepalive balance check: ${e}`);
        }
        post({ type: 'merchant_status', phase: 'watch', localRgb: lastRgb });
      }

      const hash = watchingHashRef.current;
      if (!hash) continue;

      try {
        // Each poll drives the wasm node's queued RGB work + keeps the chain moving.
        await gatewayFund(address, 0.001, 1).catch(() => {});
        await wallet.syncWallet();
        const nowRgb = await readLspChannelRgb(wallet);
        lastRgb = nowRgb;
        setLocalRgb(nowRgb);
        const delta = nowRgb - baselineRgbRef.current;

        const pays = (await wallet.listPaymentsRaw().catch(() => [])) as PaymentRow[];
        const mp = pays.find(
          (p) =>
            normHash(String(rowField<string>(p, 'paymentHash', 'payment_hash') ?? '')) ===
            normHash(hash)
        );
        const mpStatus = String(mp?.status ?? '').toLowerCase();
        addLog(
          `watch: channel RGB ${nowRgb} (Δ${delta >= 0 ? '+' : ''}${delta})  inbound=${
            mp ? `${rowField<string>(mp, 'paymentType', 'payment_type') ?? '?'}/${mp.status}` : 'none'
          }  buyerSettled=${buyerSettledRef.current}`
        );

        const merchantOk = ['succeeded', 'claimable'].includes(mpStatus);
        if (buyerSettledRef.current && (delta > 0 || merchantOk)) {
          declareSuccess(
            delta > 0
              ? `merchant received +${delta} RGB on the LSP channel`
              : 'buyer Settled + merchant inbound Succeeded — APay complete',
            nowRgb
          );
        } else if (Date.now() > watchDeadlineRef.current) {
          // Soft-fail per plan §6: stock RLN may reject the host-forward with
          // PaymentHashAlreadyUsed — delivery arrives later via the LSP outbox.
          const detail = buyerSettledRef.current
            ? 'buyer Settled — merchant delivery pending; the LSP outbox will deliver (soft-fail)'
            : 'settle watch timeout — no buyer settlement observed';
          addLog(detail, buyerSettledRef.current ? 'info' : 'error');
          post({ type: 'verdict', ok: false, soft: buyerSettledRef.current, detail });
          setCheckout({ ok: false, soft: buyerSettledRef.current, detail });
          watchingHashRef.current = '';
          if (buyerSettledRef.current) setPhase('done');
        }
      } catch (e) {
        addLog(`watch poll: ${e}`);
      }
    }
  }

  // ── Buyer: top-up via lightning_receive, then pay the Lightning Address ─────
  async function runBuyer() {
    const lnAddress = addressRef.current.trim();
    if (!lnAddress) {
      addLog('No Lightning Address yet — run the Merchant window first (or paste it).', 'error');
      return;
    }
    const { wallet, lsp, address } = await setup();

    // The LSP's virtual open gives the buyer 0 local RGB — deposit via
    // lightning_receive (faucet plays the external on-chain sender).
    setPhase('a_topup');
    req('lsp.receiveAsset', {
      assetId: short(CFG.assetId),
      amountSats: PAYMENT_MSAT / 1000,
      amountRgb: PAYMENT_ASSET_AMOUNT,
    });
    const { lnInvoice: topupInvoice, rgbInvoice: topupRgbInvoice } = await lsp.receiveAsset({
      assetId: CFG.assetId,
      amountSats: PAYMENT_MSAT / 1000,
      amountRgb: PAYMENT_ASSET_AMOUNT,
    });
    res('lsp.receiveAsset', { lnInvoice: short(topupInvoice, 32) });

    req('faucet.decodergbinvoice');
    const decoded = await faucetPost<{
      recipient_id: string;
      transport_endpoints?: string[];
      assignment?: { type: string; value: number };
    }>('/decodergbinvoice', { invoice: topupRgbInvoice });
    const assignment =
      decoded.assignment?.type === 'Fungible' && (decoded.assignment?.value ?? 0) > 0
        ? decoded.assignment
        : { type: 'Fungible', value: PAYMENT_ASSET_AMOUNT };
    res('faucet.decodergbinvoice', { recipientId: short(decoded.recipient_id) });

    // The faucet's change from the stack's seed sends can sit pending until a
    // refresh — sendrgb then 403s with InsufficientAssets.
    addLog('waiting for faucet spendable RGB…');
    const faucetDeadline = Date.now() + 60_000;
    while (Date.now() < faucetDeadline) {
      checkAbort();
      await faucetPost('/refreshtransfers', { filter: [], skip_sync: false }).catch(() => {});
      const fb = await faucetPost<{ spendable?: number }>('/assetbalance', {
        asset_id: CFG.assetId,
      }).catch(() => null);
      if ((fb?.spendable ?? 0) >= PAYMENT_ASSET_AMOUNT) {
        addLog(`  faucet spendable: ${fb?.spendable}`);
        break;
      }
      await gatewayFund(address, 0.001, 1).catch(() => {});
      await sleep(2000);
    }

    req('faucet.sendrgb', { amount: assignment.value });
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
            transport_endpoints: decoded.transport_endpoints ?? [
              'rpc://127.0.0.1:3000/json-rpc',
            ],
          },
        ],
      },
    });
    res('faucet.sendrgb');

    addLog('waiting for the on-chain transfer to settle…');
    const onchainDeadline = Date.now() + SETTLE_TIMEOUT_S * 1000;
    let settledOnchain = false;
    while (Date.now() < onchainDeadline) {
      checkAbort();
      await gatewayFund(address, 0.001, 1).catch(() => {});
      await sleep(POLL_INTERVAL_MS);
      try {
        await faucetPost('/refreshtransfers', { filter: [], skip_sync: false });
        const lt = await faucetPost<{
          transfers?: { kind?: string; status?: string; recipient_id?: string }[];
        }>('/listtransfers', { asset_id: CFG.assetId });
        // Match OUR transfer by recipient_id — the list also contains the
        // stack's seed sends, so "any settled Send" is a false positive.
        const send = (lt.transfers ?? []).find((t) => t.recipient_id === decoded.recipient_id);
        addLog(`  faucet Send: ${send?.status ?? 'none'}`);
        if (send?.status === 'Failed') throw new Error('faucet RGB send transfer failed');
        if (send?.status === 'Settled') {
          settledOnchain = true;
          break;
        }
      } catch (e) {
        if (String(e).includes('transfer failed')) throw e;
        addLog(`  topup poll: ${e}`);
      }
    }
    if (!settledOnchain) addLog('on-chain settle timeout — LSP may still be processing', 'error');

    // Keep the chain moving while the LSP validates its receive and pays our invoice.
    const topupMiner = setInterval(() => {
      gatewayFund(address, 0.001, 1).catch(() => {});
    }, POLL_INTERVAL_MS);
    let lastTopupStatus = '';
    try {
      await lsp.awaitReceiveSettlement(topupInvoice, {
        timeoutMs: SETTLE_TIMEOUT_S * 1000,
        pollIntervalMs: POLL_INTERVAL_MS,
        onProgress: (s) => {
          lastTopupStatus = s;
          addLog(`  topup invoice: ${s}`);
        },
      });
    } finally {
      clearInterval(topupMiner);
    }
    if (lastTopupStatus !== 'Succeeded') {
      throw new Error(`RGB top-up did not settle (last status: ${lastTopupStatus})`);
    }
    addLog(`deposited ${PAYMENT_ASSET_AMOUNT} RGB via lightning_receive ✓`, 'success');
    await wallet.syncWallet();

    const rgbBefore = await readLspChannelRgb(wallet);
    setLocalRgb(rgbBefore);
    addLog(`channel RGB before checkout: ${rgbBefore}`);

    // Sanity gate before paying — waitForOutboundLiquidity has no onEachPoll,
    // so run our own miner beat alongside it.
    req('lsp.waitForOutboundLiquidity', { minMsat: PAYMENT_MSAT });
    const liqMiner = setInterval(() => {
      gatewayFund(address, 0.001, 1).catch(() => {});
    }, POLL_INTERVAL_MS);
    try {
      await lsp.waitForOutboundLiquidity(PAYMENT_MSAT, {
        timeoutMs: CHANNEL_TIMEOUT_S * 1000,
        pollIntervalMs: POLL_INTERVAL_MS,
        onProgress: (m) => addLog(`  ${m}`),
      });
    } finally {
      clearInterval(liqMiner);
    }
    res('lsp.waitForOutboundLiquidity');

    setPhase('send');
    await ensureConnected(wallet, lsp); // buyer session may also have dropped during topup
    req('lsp.payAddress', {
      address: lnAddress,
      amtMsat: PAYMENT_MSAT,
      assetAmount: PAYMENT_ASSET_AMOUNT,
    });
    const { invoice, sendResult } = await lsp.payAddress({
      address: lnAddress,
      amtMsat: PAYMENT_MSAT,
      asset: { assetId: CFG.assetId, assetAmount: PAYMENT_ASSET_AMOUNT },
    });
    if (!invoice) throw new Error('payAddress returned no invoice');
    setHodlBolt11(invoice);
    const pHash = String(sendResult.txid ?? '');
    setPaymentHash(pHash);
    res('payAddress', {
      invoice: short(invoice, 32),
      status: sendResult.status,
      paymentHash: short(pHash),
    });
    if (String(sendResult.status ?? '').toLowerCase() === 'failed') {
      throw new Error(
        'payAddress failed — buyer has no spendable RGB on the LSP channel (top-up may not have settled).'
      );
    }
    post({ type: 'payment', paymentHash: pHash, status: sendResult.status ?? 'Pending' });
    addLog('Cart paid — HTLC held at LSP, waiting for outbox settlement…', 'success');

    // Poll until Settled — each getLightningSendRequest poll also drives the
    // wasm node's queued RGB work (HTLC/commitment coloring).
    setPhase('settle');
    const settleDeadline = Date.now() + SETTLE_TIMEOUT_S * 1000;
    let payStatus: string | null = 'Pending';
    while (Date.now() < settleDeadline) {
      checkAbort();
      await gatewayFund(address, 0.001, 1).catch(() => {});
      await sleep(POLL_INTERVAL_MS);
      payStatus = await wallet.getLightningSendRequest(pHash);
      setSendStatus(payStatus ?? 'Pending');
      post({ type: 'payment', paymentHash: pHash, status: payStatus ?? 'Pending' });
      addLog(`  getLightningSendRequest: ${payStatus ?? 'Pending'}`);
      if (payStatus === 'Settled' || payStatus === 'Failed') break;
    }
    if (payStatus === 'Failed') throw new Error('buyer payment Failed during LSP settlement');
    if (payStatus !== 'Settled') {
      throw new Error('Timeout — payment did not settle; ensure the Merchant window stays open.');
    }

    const rgbAfter = await readLspChannelRgb(wallet);
    setLocalRgb(rgbAfter);
    addLog(
      `payment Settled ✓  channel RGB ${rgbBefore} → ${rgbAfter} (${rgbAfter - rgbBefore})`,
      'success'
    );
    setPhase('done');
  }

  const run = useCallback(async () => {
    abortRef.current = false;
    watchingHashRef.current = '';
    buyerSettledRef.current = false;
    if (rebroadcastRef.current) clearInterval(rebroadcastRef.current);
    setLog([]);
    setErrorMsg('');
    setChannel(null);
    setHodlBolt11('');
    setPaymentHash('');
    setSendStatus('');
    setCheckout(null);
    setLocalRgb(null);
    setUnusedHashes(null);
    if (!CFG.assetId) {
      setErrorMsg('VITE_LSP_REGTEST_ASSET_ID not set — run ./scripts/start-lsp-web.sh');
      setPhase('error');
      return;
    }
    if (walletRef.current) {
      // One RLN wallet per tab — a second run would race the first wallet's loops.
      setErrorMsg('This tab already ran a flow — use "Clear wallets & reload" for a fresh run.');
      setPhase('error');
      return;
    }
    try {
      if (role === 'merchant') await runMerchant();
      else await runBuyer();
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      addLog(`Fatal: ${msg}`, 'error');
      setErrorMsg(msg);
      setPhase('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, addLog]);

  // Stop loops + clear UI state. The RLN wallet itself cannot be torn down
  // in-tab — use clearWalletsAndReload() for a truly fresh run.
  const reset = useCallback(() => {
    abortRef.current = true;
    if (rebroadcastRef.current) clearInterval(rebroadcastRef.current);
    watchingHashRef.current = '';
    setPhase('idle');
    setLog([]);
    setErrorMsg('');
    setChannel(null);
    setHodlBolt11('');
    setPaymentHash('');
    setSendStatus('');
    setCheckout(null);
    setLocalRgb(null);
    setUnusedHashes(null);
    if (role === 'buyer') setAddress('');
  }, [role, setAddress]);

  return {
    role,
    phase,
    log,
    errorMsg,
    run,
    reset,
    lightningAddress,
    /** Buyer: manual paste escape hatch (plan §3). */
    setLightningAddress: setAddress,
    unusedHashes,
    channel,
    hodlBolt11,
    paymentHash,
    sendStatus,
    otherStatus,
    localRgb,
    checkout,
    envReady: !!(CFG.assetId && CFG.lspPubkey),
    isRunning: !['idle', 'done', 'error'].includes(phase),
  };
}
