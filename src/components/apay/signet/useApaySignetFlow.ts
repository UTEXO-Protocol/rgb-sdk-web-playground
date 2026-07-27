// APay Cart Checkout · UTEXO (signet) — port of ../useApayFlow.ts to the live
// signet stack, mirroring rgb-sdk-rn-demo/screens/apay-signet/useApayFlow.ts.
//
// Same two-window split as the regtest flow (Run 1 = Merchant, Run 2 = Buyer,
// coordinated over BroadcastChannel), with the signet differences:
//   - network 'utexo' — proxy/transport/indexer come from the SDK defaults
//   - no gatewayFund mining beats — fund / UTXO / settlement are reached by
//     polling for signet confirmations with long timeouts
//   - the faucet RLN node funds BTC (sendbtc) and sends the buyer's RGB
//     top-up on-chain to the LSP (sendrgb), via the /faucet-signet proxy
//   - createLsp() auto-discovers the LSP peer from lspBaseUrl (GET /get_info)
// Merchant never calls claimHodlInvoice — the LSP outbox delivers.
import { useCallback, useEffect, useRef, useState } from 'react';
import { UTEXOWallet, generateKeys, type UtexoLsp } from '@utexo/rgb-sdk-web';
import { useStore } from '../../../store';
import { DEMO_VSS_URL } from '../../../lib/utils';
import {
  normHash,
  short,
  sleep,
  type ApayBcMessage,
  type LogEntry,
  type Phase,
  type Role,
} from '../config';
import type { ChannelInfo, CheckoutVerdict } from '../useApayFlow';
import {
  APAY_HASH_REFILL_THRESHOLD,
  BC_NAME_SIGNET,
  CHANNEL_TIMEOUT_MS,
  FAUCET_BTC_SAT,
  FAUCET_CONFIGURED,
  FEE_RATE,
  FUND_TIMEOUT_MS,
  LNADDRESS_REBROADCAST_MS,
  MERCHANT_KEEPALIVE_MS,
  PAYMENT_ASSET_AMOUNT,
  PAYMENT_MSAT,
  POLL_MS,
  SETTLE_TIMEOUT_MS,
  SIG,
  UTXO_NUM,
  faucet,
} from './config';

// Stable mnemonic per role — re-running the same role reuses it, so faucet
// funding hits the same keys across retries (same pattern as regtest).
async function roleMnemonic(role: Role): Promise<string> {
  const key = `apay-signet-mnemonic-${role}`;
  const saved = localStorage.getItem(key);
  if (saved) return saved;
  const k = await generateKeys('utexo');
  localStorage.setItem(key, k.mnemonic);
  return k.mnemonic;
}

export function useApaySignetFlow(role: Role) {
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
        `[apay-signet:${role}] ${msg}`,
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

  // Cross-window coordination — merchant publishes its Lightning Address +
  // status; buyer publishes payment hash/status; merchant answers with the
  // settlement verdict. Own channel name so a regtest run can't cross-talk.
  useEffect(() => {
    const bc = new BroadcastChannel(BC_NAME_SIGNET);
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
          watchDeadlineRef.current = Date.now() + SETTLE_TIMEOUT_MS;
          buyerSettledRef.current = false;
          addLog(`buyer payment hash received: ${short(m.paymentHash)} — watching settlement`);
        }
        if (m.status === 'Succeeded') buyerSettledRef.current = true;
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

  // Virtual channels drop the LSP's TCP session right after open — skip if
  // already connected, retry instead of dying (same quirk as regtest).
  async function ensureConnected(wallet: UTEXOWallet, lsp: UtexoLsp, attempts = 4) {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      checkAbort();
      try {
        const peers = await wallet.listPeers().catch(() => []);
        if (peers.some((p) => p.pubkey === lsp.peer.peerPubkey && p.isConnected !== false))
          return;
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
  async function readLspChannelRgb(wallet: UTEXOWallet, lsp: UtexoLsp): Promise<number> {
    const channels = await wallet.listChannels();
    const chan = channels.find(
      (c) => c.assetId === SIG.assetId && c.peerPubkey === lsp.peer.peerPubkey
    );
    return Number(chan?.assetLocalAmount ?? 0);
  }

  // Poll a wallet until it reports settled BTC > 0 (funding confirmed).
  async function pollFunded(wallet: UTEXOWallet, label: string): Promise<void> {
    const deadline = Date.now() + FUND_TIMEOUT_MS;
    while (Date.now() < deadline) {
      checkAbort();
      await sleep(POLL_MS);
      try {
        await wallet.syncWallet();
        const b = (await wallet.getBtcBalance()) as {
          vanilla?: { settled?: number };
          colored?: { settled?: number };
        };
        const settled = (b?.vanilla?.settled ?? 0) + (b?.colored?.settled ?? 0);
        addLog(`  ${label} settled BTC: ${settled} sat`);
        if (settled > 0) return;
      } catch (e) {
        addLog(`  fund poll: ${e}`);
      }
    }
    throw new Error(`Timed out waiting for ${label} BTC funding (signet confirmations)`);
  }

  // Poll a wallet until the createUtxos tx confirms (spendable appears).
  async function pollUtxosConfirmed(wallet: UTEXOWallet, label: string): Promise<void> {
    const deadline = Date.now() + FUND_TIMEOUT_MS;
    while (Date.now() < deadline) {
      checkAbort();
      await sleep(POLL_MS);
      try {
        await wallet.syncWallet();
        const b = (await wallet.getBtcBalance()) as {
          vanilla?: { spendable?: number };
          colored?: { spendable?: number };
        };
        const spendable = (b?.vanilla?.spendable ?? 0) + (b?.colored?.spendable ?? 0);
        addLog(`  ${label} spendable BTC: ${spendable} sat`);
        if (spendable > 0) {
          addLog(`  ${label} UTXOs confirmed ✓`, 'success');
          return;
        }
      } catch (e) {
        addLog(`  utxo poll: ${e}`);
      }
    }
    addLog(`${label} UTXO confirmation timeout — continuing`);
  }

  // ── Shared setup: wallet → faucet fund → utxos → LSP channel ────────────────
  async function setup(): Promise<{ wallet: UTEXOWallet; lsp: UtexoLsp }> {
    setPhase(role === 'merchant' ? 'b_init' : 'a_init');
    const mnemonic = await roleMnemonic(role);
    // Fresh dataDir + nodeRuntimeId per run → full chain scan instead of a
    // stale checkpoint; mnemonic stays stable so funding hits the same keys.
    const fresh = Date.now().toString(16);
    req(`${role}.create`, { network: 'utexo', dataDir: `/apay_sig_${role}_${fresh}` });
    const wallet = new UTEXOWallet({
      network: 'utexo',
      mnemonic,
      password: `apay-signet-${role}`,
      lspBaseUrl: SIG.lspBaseUrl,
      lspBearerToken: SIG.lspBearerToken || undefined,
      // undefined → SDK per-network defaults (RlnDefaults.ts)
      proxyUrl: SIG.proxyUrl,
      indexerUrl: SIG.indexerUrl,
      transportEndpoint: SIG.transportEndpoint,
      dataDir: `/apay_sig_${role}_${fresh}`,
      nodeRuntimeId: `apay-signet-${role}-${fresh}`,
      vssUrl: DEMO_VSS_URL,
    });
    await wallet.init();
    await wallet.unlock();
    walletRef.current = wallet;
    if (!wallet.isOnline())
      throw new Error('signet indexer unreachable — check the network / SDK defaults');
    const address = await wallet.getAddress();
    res(`${role}.create`, { address: short(address) });

    setPhase(role === 'merchant' ? 'b_fund' : 'a_fund');
    await wallet.syncWallet();
    const bal = (await wallet.getBtcBalance()) as { vanilla?: { settled?: number } };
    if ((bal?.vanilla?.settled ?? 0) > 0) {
      addLog(`already funded (${bal?.vanilla?.settled} sat settled) — skipping faucet`);
    } else {
      req('faucet.sendBtc', { amount: FAUCET_BTC_SAT, address: short(address, 18) });
      await faucet.sendBtc(address, FAUCET_BTC_SAT, FEE_RATE);
      res('faucet.sendBtc');
      addLog('waiting for the funding tx to confirm on signet…');
      await pollFunded(wallet, role);
    }
    res(`${role}.funded`);

    setPhase(role === 'merchant' ? 'b_utxos' : 'a_utxos');
    req(`${role}.createUtxos`, { num: UTXO_NUM, feeRate: FEE_RATE });
    await wallet.syncWallet();
    await wallet.refreshWallet();
    await wallet.createUtxos({ upTo: false, num: UTXO_NUM, feeRate: FEE_RATE });
    res(`${role}.createUtxos`);
    await pollUtxosConfirmed(wallet, role);

    addLog('attaching LN node…');
    wallet.attachLightningNode();

    setPhase(role === 'merchant' ? 'b_channel' : 'a_channel');
    // Auto-discover the LSP peer from lspBaseUrl (GET /get_info), port 9735.
    const lsp = await wallet.createLsp();
    lspRef.current = lsp;
    req('lsp.connect', { peer: short(lsp.peer.peerPubkey) });
    await ensureConnected(wallet, lsp);
    res('lsp.connect');

    addLog(
      `waiting for the LSP → ${role} RGB channel (~10 min on signet, asset ${short(SIG.assetId)})…`
    );
    const chan = await lsp.waitForChannel(SIG.assetId, {
      timeoutMs: CHANNEL_TIMEOUT_MS,
      pollIntervalMs: POLL_MS,
      onProgress: (m) => addLog(`  ${role} ${m}`),
    });
    setChannel({ capacitySat: chan.capacitySat, outboundBalanceMsat: chan.outboundBalanceMsat });
    addLog(
      `RGB channel usable ✓ cap=${chan.capacitySat} sat outbound=${chan.outboundBalanceMsat} msat`,
      'success'
    );
    return { wallet, lsp };
  }

  // ── Merchant: register Lightning Address, then keepalive + settle watcher ───
  async function runMerchant() {
    const { wallet, lsp } = await setup();

    baselineRgbRef.current = await readLspChannelRgb(wallet, lsp);
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
      await sleep(POLL_MS);
      if (abortRef.current) break;

      sinceKeepalive += POLL_MS;
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
        // the buyer's BroadcastChannel message arrived — detect the channel RGB
        // delta directly.
        try {
          await wallet.syncWallet();
          const nowRgb = await readLspChannelRgb(wallet, lsp);
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
        await wallet.syncWallet();
        await wallet.refreshWallet();
        const nowRgb = await readLspChannelRgb(wallet, lsp);
        lastRgb = nowRgb;
        setLocalRgb(nowRgb);
        const delta = nowRgb - baselineRgbRef.current;

        const pays = await wallet.listPayments().catch(() => []);
        const mp = pays.find((p) => normHash(p.paymentHash) === normHash(hash));
        const mpStatus = String(mp?.status ?? '').toLowerCase();
        addLog(
          `watch: channel RGB ${nowRgb} (Δ${delta >= 0 ? '+' : ''}${delta})  inbound=${
            mp ? `${mp.inbound ? 'inbound' : 'outbound'}/${mp.status}` : 'none'
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
    const { wallet, lsp } = await setup();

    // The LSP never pushes RGB at channel open — the buyer acquires outbound
    // balance by *receiving* over the channel. The faucet node plays the
    // external on-chain RGB sender.
    setPhase('a_topup');
    req('lsp.receiveAsset', {
      assetId: short(SIG.assetId),
      amountSats: PAYMENT_MSAT / 1000,
      amountRgb: PAYMENT_ASSET_AMOUNT,
    });
    const { lnInvoice: topupInvoice, rgbInvoice: topupRgbInvoice } = await lsp.receiveAsset({
      assetId: SIG.assetId,
      amountSats: PAYMENT_MSAT / 1000,
      amountRgb: PAYMENT_ASSET_AMOUNT,
    });
    res('lsp.receiveAsset', { lnInvoice: short(topupInvoice, 32) });

    req('faucet.decodergbinvoice');
    const decoded = await faucet.decodeRgbInvoice(topupRgbInvoice);
    const assignment =
      decoded.assignment?.type === 'Fungible' && (decoded.assignment?.value ?? 0) > 0
        ? decoded.assignment
        : { type: 'Fungible', value: PAYMENT_ASSET_AMOUNT };
    res('faucet.decodergbinvoice', { recipientId: short(decoded.recipient_id) });

    req('faucet.sendrgb', { amount: assignment.value });
    await faucet.sendRgb({
      donation: false,
      fee_rate: FEE_RATE,
      min_confirmations: 1,
      skip_sync: false,
      recipient_map: {
        [SIG.assetId]: [
          {
            recipient_id: decoded.recipient_id,
            assignment,
            transport_endpoints: decoded.transport_endpoints ?? [],
          },
        ],
      },
    });
    res('faucet.sendrgb');

    await sleep(2000);
    await faucet.refresh().catch(() => {});

    addLog('waiting for the on-chain transfer to settle (signet confirmations)…');
    const onchainDeadline = Date.now() + SETTLE_TIMEOUT_MS;
    let settledOnchain = false;
    while (Date.now() < onchainDeadline) {
      checkAbort();
      await sleep(POLL_MS);
      try {
        await faucet.refresh().catch(() => {});
        const lt = await faucet.listTransfers(SIG.assetId);
        // Match OUR transfer by recipient_id — the list also contains other
        // sends, so "any settled Send" is a false positive.
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

    addLog('waiting for the buyer top-up LN invoice to settle…');
    let lastTopupStatus = '';
    await lsp.awaitReceiveSettlement(topupInvoice, {
      timeoutMs: SETTLE_TIMEOUT_MS,
      pollIntervalMs: POLL_MS,
      onProgress: (s) => {
        lastTopupStatus = s;
        addLog(`  topup invoice: ${s}`);
      },
    });
    if (lastTopupStatus !== 'Succeeded') {
      throw new Error(
        `RGB top-up did not settle (last status: ${lastTopupStatus}) — check LSP RGB inventory and proxy reachability`
      );
    }
    addLog(`deposited ${PAYMENT_ASSET_AMOUNT} RGB via lightning_receive ✓`, 'success');
    await wallet.syncWallet();

    const rgbBefore = await readLspChannelRgb(wallet, lsp);
    setLocalRgb(rgbBefore);
    addLog(`channel RGB before checkout: ${rgbBefore}`);

    // Sanity gate before paying.
    req('lsp.waitForOutboundLiquidity', { minMsat: PAYMENT_MSAT });
    await lsp.waitForOutboundLiquidity(PAYMENT_MSAT, {
      timeoutMs: CHANNEL_TIMEOUT_MS,
      pollIntervalMs: POLL_MS,
      onProgress: (m) => addLog(`  ${m}`),
    });
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
      asset: { assetId: SIG.assetId, assetAmount: PAYMENT_ASSET_AMOUNT },
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

    setPhase('settle');
    const settleDeadline = Date.now() + SETTLE_TIMEOUT_MS;
    let payStatus: string | null = 'Pending';
    while (Date.now() < settleDeadline) {
      checkAbort();
      await sleep(POLL_MS);
      payStatus = await wallet.getLightningSendStatus(pHash);
      setSendStatus(payStatus ?? 'Pending');
      post({ type: 'payment', paymentHash: pHash, status: payStatus ?? 'Pending' });
      addLog(`  getLightningSendStatus: ${payStatus ?? 'Pending'}`);
      if (payStatus === 'Succeeded' || payStatus === 'Failed') break;
    }
    if (payStatus === 'Failed') throw new Error('buyer payment Failed during LSP settlement');
    if (payStatus !== 'Succeeded') {
      throw new Error('Timeout — payment did not settle; ensure the Merchant window stays open.');
    }

    const rgbAfter = await readLspChannelRgb(wallet, lsp);
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
    if (!FAUCET_CONFIGURED) {
      setErrorMsg('VITE_SIGNET_FAUCET_URL not set — add it to .env.local and restart npm run dev.');
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
    /** Buyer: manual paste escape hatch. */
    setLightningAddress: setAddress,
    unusedHashes,
    channel,
    hodlBolt11,
    paymentHash,
    sendStatus,
    otherStatus,
    localRgb,
    checkout,
    envReady: FAUCET_CONFIGURED && !!SIG.assetId,
    isRunning: !['idle', 'done', 'error'].includes(phase),
  };
}
