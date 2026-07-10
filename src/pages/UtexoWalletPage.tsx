import React, { useState, useEffect } from 'react';
import { generateKeys, UTEXOWallet, getDefaultLspBaseUrl } from '@utexo/rgb-sdk-web';
import type { UtexoLsp, LspPeer } from '@utexo/rgb-sdk-web';
import { useStore } from '../store';
import type { WalletInstance, WalletConfig } from '../store';
import { Section } from '../components/Section';
import { Field, inputCls, selectCls, textareaCls } from '../components/Field';
import { Btn } from '../components/Btn';
import { OutputBox } from '../components/OutputBox';
import { StepFlow } from '../components/StepFlow';
import { useActiveWallet } from '../hooks/useActiveWallet';
import { json, getIndexerUrl, getRlnTransportEndpoint, getRlnProxyUrl, proxyIndexerUrl, parseAmounts, FAUCET_BASE_URL, FAUCET_TOKEN, UTEXO_FAUCET_URL, faucetSendBtc, gatewayRegtestFund } from '../lib/utils';
import { saveSessions, setUrlWallet } from '../lib/session';
import { CFG as REGTEST_LSP_CFG } from '../components/apay/config';

let walletCounter = 0;
function nextId() {
  return 'utexo_' + (++walletCounter) + '_' + Date.now();
}

// All networks the RLN-backed UTEXOWallet supports (regtest/utexo have full
// URL defaults in the SDK — indexer, transport, LN gateway; see DEFAULT_RLN_URLS).
const UTEXO_NETWORKS = ['regtest', 'utexo', 'signet', 'testnet', 'mainnet'] as const;
type UtexoNetwork = typeof UTEXO_NETWORKS[number];

// Side navigation — ids must match the Section id="sec-…" anchors below.
const SECTION_NAV = [
  {
    group: 'Onchain',
    items: [
      { id: 'create', label: '1 · Create wallet' },
      { id: 'online', label: '2 · goOnline' },
      { id: 'info', label: '3 · Wallet info' },
      { id: 'fund', label: '4 · Fund wallet' },
      { id: 'send-btc', label: '5 · Send BTC' },
      { id: 'utxos', label: '6 · Create UTXOs' },
      { id: 'sync', label: '7 · Sync' },
      { id: 'nia', label: '8 · Issue NIA' },
      { id: 'ifa', label: '9 · Issue IFA' },
      { id: 'assets', label: '10 · List assets' },
      { id: 'receive', label: '11 · Receive RGB' },
      { id: 'send-rgb', label: '12 · Send RGB' },
      { id: 'transfers', label: '13 · Transfers' },
      { id: 'keys', label: '14 · Keys' },
      { id: 'validate', label: '15 · Validate balance' },
      { id: 'crypto', label: '16 · Decode / Sign' },
    ],
  },
  {
    group: 'Lightning',
    items: [
      { id: 'ln-peers', label: '17 · Node & peers' },
      { id: 'ln-channels', label: '18 · Channels' },
      { id: 'ln-invoice', label: '19 · Create invoice' },
      { id: 'ln-pay', label: '20 · Pay invoice' },
      { id: 'ln-status', label: '21 · Status & decode' },
    ],
  },
  {
    group: 'LSP',
    items: [
      { id: 'lsp-connect', label: '22 · Create + Connect' },
      { id: 'lsp-receive', label: '23 · Receive asset' },
      { id: 'lsp-send', label: '24 · Send asset' },
      { id: 'lsp-pay', label: '25 · Pay LN address' },
      { id: 'lsp-apay', label: '26 · APay' },
    ],
  },
];

const ALL_NAV_ITEMS = SECTION_NAV.flatMap((g) => g.items);

function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <h2 className="text-[#c9d1d9] text-sm font-bold uppercase tracking-widest whitespace-nowrap">{children}</h2>
      <div className="flex-1 h-px bg-[#30363d]" />
    </div>
  );
}

export function UtexoWalletPage() {
  const addLog = useStore((s) => s.addLog);
  const addWallet = useStore((s) => s.addWallet);
  const removeWallet = useStore((s) => s.removeWallet);
  const updateWallet = useStore((s) => s.updateWallet);
  const wallets = useStore((s) => s.wallets);
  const activeWallet = useActiveWallet();
  const utexo = activeWallet?.type === 'utexo' ? activeWallet.instance as UTEXOWallet : null;
  const walletId = activeWallet?.id ?? '';

  // ── Create wallet ─────────────────────────────────────────────────────────
  const [network, setNetwork] = useState<UtexoNetwork>('regtest');
  const [mnemonic, setMnemonic] = useState('');
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [createOut, setCreateOut] = useState('');
  const [showMnemonic, setShowMnemonic] = useState(false);
  // RLN-backed UTEXOWallet requires an SDK password. indexer/transport/proxy
  // URLs are optional — blank fields fall back to the SDK's per-network
  // defaults (DEFAULT_RLN_URLS → DEFAULT_INDEXER_URLS).
  const [password, setPassword] = useState('demo-password');
  const [transportEndpoint, setTransportEndpoint] = useState('');
  const [proxyUrl, setProxyUrl] = useState('');

  // ── Go Online ─────────────────────────────────────────────────────────────
  const [indexerUrl, setIndexerUrl] = useState(() => getIndexerUrl('regtest'));
  const [onlineOut, setOnlineOut] = useState('');

  // ── Wallet info ───────────────────────────────────────────────────────────
  const [infoOut, setInfoOut] = useState('');

  // ── Sync ──────────────────────────────────────────────────────────────────
  const [syncOut, setSyncOut] = useState('');

  // ── BTC Send ──────────────────────────────────────────────────────────────
  const [btcAddress, setBtcAddress] = useState('');
  const [btcAmount, setBtcAmount] = useState('');
  const [btcFeeRate, setBtcFeeRate] = useState('2');
  const [btcPendingPsbt, setBtcPendingPsbt] = useState<string | null>(null);
  const [btcSignedPsbt, setBtcSignedPsbt] = useState<string | null>(null);
  const [btcOut, setBtcOut] = useState('');

  // ── Create UTXOs ──────────────────────────────────────────────────────────
  const [utxoNum, setUtxoNum] = useState('');
  const [utxoSize, setUtxoSize] = useState('');
  const [utxoFee, setUtxoFee] = useState('');
  const [utxoPendingPsbt, setUtxoPendingPsbt] = useState<string | null>(null);
  const [utxoSignedPsbt, setUtxoSignedPsbt] = useState<string | null>(null);
  const [utxosOut, setUtxosOut] = useState('');

  // ── RGB Assets ────────────────────────────────────────────────────────────
  const [assetIdQuery, setAssetIdQuery] = useState('');
  const [niaTicker, setNiaTicker] = useState('DEMO');
  const [niaName, setNiaName] = useState('Demo Token');
  const [niaPrecision, setNiaPrecision] = useState('0');
  const [niaAmounts, setNiaAmounts] = useState('1000');
  const [niaOut, setNiaOut] = useState('');

  const [ifaTicker, setIfaTicker] = useState('INFL');
  const [ifaName, setIfaName] = useState('Inflatable Token');
  const [ifaPrecision, setIfaPrecision] = useState('0');
  const [ifaAmounts, setIfaAmounts] = useState('500');
  const [ifaInflationAmounts, setIfaInflationAmounts] = useState('1000');
  const [ifaReplaceRights, setIfaReplaceRights] = useState('0');
  const [ifaOut, setIfaOut] = useState('');

  const [listOut, setListOut] = useState('');

  // ── Receive ───────────────────────────────────────────────────────────────
  const [recvAssetId, setRecvAssetId] = useState('');
  const [recvAmount, setRecvAmount] = useState('');
  const [recvDuration, setRecvDuration] = useState('');
  const [recvWitness, setRecvWitness] = useState('true');
  const [recvOut, setRecvOut] = useState('');

  // ── Send Assets ───────────────────────────────────────────────────────────
  const [sendInvoice, setSendInvoice] = useState('');
  const [sendAssetId, setSendAssetId] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendFeeRate, setSendFeeRate] = useState('2');
  const [sendDonation, setSendDonation] = useState('false');
  const [sendWitnessSats, setSendWitnessSats] = useState('');
  const [sendPendingPsbt, setSendPendingPsbt] = useState<string | null>(null);
  const [sendSignedPsbt, setSendSignedPsbt] = useState<string | null>(null);
  const [sendOut, setSendOut] = useState('');

  // ── Transactions & Transfers ──────────────────────────────────────────────
  const [txAssetId, setTxAssetId] = useState('');
  const [failBatchIdx, setFailBatchIdx] = useState('');
  const [txOut, setTxOut] = useState('');

  // ── Keys ──────────────────────────────────────────────────────────────────
  const [pubKeysOut, setPubKeysOut] = useState('');

  // ── Lightning ─────────────────────────────────────────────────────────────
  const [lnAssetId, setLnAssetId] = useState('');
  const [lnAmount, setLnAmount] = useState('');
  const [lnInvoice, setLnInvoice] = useState('');
  const [lnSendAssetId, setLnSendAssetId] = useState('');
  const [lnSendAmount, setLnSendAmount] = useState('');
  const [lnPaymentHash, setLnPaymentHash] = useState('');
  const [lnOut, setLnOut] = useState('');
  const [lnPayOut, setLnPayOut] = useState('');
  const [lnStatusOut, setLnStatusOut] = useState('');

  // ── Validate balance ──────────────────────────────────────────────────────
  const [validateAssetId, setValidateAssetId] = useState('');
  const [validateAmount, setValidateAmount] = useState('');
  const [validateOut, setValidateOut] = useState('');

  // ── Decode / Sign / Verify ────────────────────────────────────────────────
  const [decodeInvoice, setDecodeInvoice] = useState('');
  const [signMsg, setSignMsg] = useState('');
  const [verifyMsg, setVerifyMsg] = useState('');
  const [verifySig, setVerifySig] = useState('');
  const [cryptoOut, setCryptoOut] = useState('');

  // ── Faucet funding ────────────────────────────────────────────────────────
  const [fundAmount, setFundAmount] = useState('10000');
  const [fundFeeRate, setFundFeeRate] = useState('5');
  const [fundOut, setFundOut] = useState('');

  useEffect(() => {
    setIndexerUrl(getIndexerUrl(network));
  }, [network]);

  // ── Side navigation ───────────────────────────────────────────────────────
  const [activeSection, setActiveSection] = useState('create');

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) setActiveSection(visible[0].target.id.replace('sec-', ''));
      },
      { rootMargin: '0px 0px -60% 0px' }
    );
    for (const s of ALL_NAV_ITEMS) {
      const el = document.getElementById('sec-' + s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  function scrollToSection(id: string) {
    document.getElementById('sec-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveSection(id);
  }

  const activeUtexoNetwork = activeWallet?.type === 'utexo' ? activeWallet.config.network : null;
  const fundSupported =
    activeUtexoNetwork === 'regtest' || activeUtexoNetwork === 'utexo' || activeUtexoNetwork === 'testnet';

  const utexoWarn = !utexo && (
    <p className="text-xs text-[#d29922] mb-3">Switch to a UTEXOWallet in the header, or create one below.</p>
  );

  // ── Create wallet ─────────────────────────────────────────────────────────

  async function handleGenMnemonic() {
    try {
      const keys = await generateKeys(network);
      setMnemonic(keys.mnemonic);
      addLog('Mnemonic generated', 'ok');
    } catch (e) {
      addLog('Generate mnemonic failed: ' + e, 'err');
    }
  }

  async function handleCreate() {
    if (!mnemonic.trim()) { setCreateOut('Generate or enter a mnemonic first'); return; }
    setCreating(true);
    setCreateOut('Creating UTEXOWallet...');
    try {
      const walletLabel = label.trim() || 'UTEXOWallet (' + network + ')';
      addLog('Creating UTEXOWallet (' + network + ')...', 'info');
      // init() auto-connects — indexer/transport/proxy fall back to the
      // network defaults when the fields are left blank.
      console.log('UTEXOWallet init params', indexerUrl);
      const params = {
        mnemonic: mnemonic.trim(),
        password,
        network,
        transportEndpoint: transportEndpoint.trim() || undefined,
        proxyUrl: proxyUrl.trim() || undefined,
        indexerUrl: indexerUrl.trim() ? proxyIndexerUrl(indexerUrl.trim()) : undefined,
      };
      const inst = new UTEXOWallet(params);
      await inst.init();

      const xpubs = inst.getXpub();
      const config: WalletConfig = {
        network,
        indexerUrl,
        transportEndpoint: transportEndpoint.trim(),
        proxyUrl: proxyUrl.trim() || undefined,
        masterFingerprint: '',
        xpubVan: xpubs.xpubVan,
        xpubCol: xpubs.xpubCol,
        mnemonic: mnemonic.trim(),
        password,
      };

      const w: WalletInstance = {
        id: nextId(),
        label: walletLabel,
        type: 'utexo',
        config,
        instance: inst,
        online: inst.isOnline(),
      };

      addWallet(w);
      const nextWallets = [...wallets, w];
      saveSessions(nextWallets, w.id);
      setUrlWallet(w.id);
      setCreateOut('UTEXOWallet created\nLabel: ' + walletLabel + '\nNetwork: ' + network + '\nOnline: ' + (inst.isOnline() ? 'yes' : 'no — use goOnline() to retry'));
      addLog('UTEXOWallet "' + walletLabel + '" created', 'ok');
      setMnemonic('');
      setLabel('');
    } catch (e) {
      setCreateOut('Error: ' + e);
      addLog('Create failed: ' + e, 'err');
    } finally {
      setCreating(false);
    }
  }

  function handleRemoveWallet() {
    if (!activeWallet) return;
    if (!window.confirm('Remove wallet "' + activeWallet.label + '"?')) return;
    removeWallet(activeWallet.id);
    const remaining = wallets.filter((w) => w.id !== activeWallet.id);
    saveSessions(remaining, remaining[remaining.length - 1]?.id ?? null);
    addLog('Wallet "' + activeWallet.label + '" removed', 'warn');
  }

  // ── Go Online ─────────────────────────────────────────────────────────────

  async function handleGoOnline() {
    if (!utexo) { setOnlineOut('Create or switch to a UTEXOWallet'); return; }
    try {
      addLog('Going online...', 'info');
      await utexo.goOnline(proxyIndexerUrl(indexerUrl));
      updateWallet(walletId, { online: true });
      setOnlineOut('Online — ' + indexerUrl);
      addLog('UTEXOWallet online', 'ok');
    } catch (e) {
      setOnlineOut('Error: ' + e);
      addLog('goOnline failed: ' + e, 'err');
    }
  }

  // ── Wallet info ───────────────────────────────────────────────────────────

  async function handleGetAddress() {
    if (!utexo) { setInfoOut('No UTEXOWallet active'); return; }
    try {
      const addr = await utexo.getAddress();
      setInfoOut('Address: ' + addr);
      addLog('Address: ' + addr, 'ok');
    } catch (e) { setInfoOut('Error: ' + e); }
  }

  async function handleGetBalance() {
    if (!utexo) { setInfoOut('No UTEXOWallet active'); return; }
    try {
      const bal = await utexo.getBtcBalance();
      setInfoOut(json(bal));
      addLog('BTC balance retrieved', 'ok');
    } catch (e) { setInfoOut('Error: ' + e); }
  }

  async function handleListAssets() {
    if (!utexo) { setListOut('No UTEXOWallet active'); return; }
    try {
      const assets = await utexo.listAssets();
      setListOut(json(assets));
      addLog('Assets listed', 'ok');
    } catch (e) { setListOut('Error: ' + e); }
  }

  async function handleGetAssetBalance() {
    if (!utexo) { setListOut('No UTEXOWallet active'); return; }
    if (!assetIdQuery.trim()) { setListOut('Enter an asset ID'); return; }
    try {
      const bal = await utexo.getAssetBalance(assetIdQuery.trim());
      setListOut(json(bal));
      addLog('Asset balance retrieved', 'ok');
    } catch (e) { setListOut('Error: ' + e); }
  }

  async function handleListUnspents() {
    if (!utexo) { setInfoOut('No UTEXOWallet active'); return; }
    try {
      const u = await utexo.listUnspents();
      setInfoOut(json(u));
      addLog('Unspents: ' + (u?.length ?? 0), 'ok');
    } catch (e) { setInfoOut('Error: ' + e); }
  }

  // ── Sync ──────────────────────────────────────────────────────────────────

  async function handleSync() {
    if (!utexo) { setSyncOut('No UTEXOWallet active'); return; }
    try {
      addLog('Syncing...', 'info');
      await utexo.syncWallet();
      setSyncOut('Wallet synced');
      addLog('Synced', 'ok');
    } catch (e) { setSyncOut('Error: ' + e); addLog('Sync failed: ' + e, 'err'); }
  }

  async function handleRefresh() {
    if (!utexo) { setSyncOut('No UTEXOWallet active'); return; }
    try {
      addLog('Refreshing transfers...', 'info');
      await utexo.refreshWallet();
      setSyncOut('Wallet refreshed');
      addLog('Refreshed', 'ok');
    } catch (e) { setSyncOut('Error: ' + e); addLog('Refresh failed: ' + e, 'err'); }
  }

  // ── BTC Send ──────────────────────────────────────────────────────────────

  async function handleBtcBegin() {
    if (!utexo) { setBtcOut('No UTEXOWallet active'); return; }
    if (!btcAddress.trim() || !btcAmount) { setBtcOut('Enter address and amount'); return; }
    addLog('BTC send begin...', 'info');
    const psbt = await utexo.sendBtcBegin({ address: btcAddress.trim(), amount: parseInt(btcAmount), feeRate: parseFloat(btcFeeRate) || 2 });
    setBtcPendingPsbt(psbt);
    setBtcSignedPsbt(null);
    setBtcOut('Step 1 — Unsigned PSBT:\n' + psbt);
    addLog('BTC PSBT ready', 'ok');
  }

  async function handleBtcSign() {
    if (!utexo || !btcPendingPsbt) { setBtcOut('Run Step 1 first'); return; }
    const signed = await utexo.signPsbt(btcPendingPsbt);
    setBtcSignedPsbt(signed);
    setBtcOut('Step 2 — Signed PSBT:\n' + signed);
    addLog('BTC PSBT signed', 'ok');
  }

  async function handleBtcEnd() {
    if (!utexo || !btcSignedPsbt) { setBtcOut('Sign PSBT first'); return; }
    const txid = await utexo.sendBtcEnd({ signedPsbt: btcSignedPsbt });
    setBtcPendingPsbt(null); setBtcSignedPsbt(null);
    setBtcOut('Sent! txid: ' + txid);
    addLog('BTC sent: ' + txid, 'ok');
  }

  async function handleBtcAuto() {
    if (!utexo) { setBtcOut('No UTEXOWallet active'); return; }
    if (!btcAddress.trim() || !btcAmount) { setBtcOut('Enter address and amount'); return; }
    addLog('BTC send (auto)...', 'info');
    const txid = await utexo.sendBtc({ address: btcAddress.trim(), amount: parseInt(btcAmount), feeRate: parseFloat(btcFeeRate) || 2 });
    setBtcOut('Sent! txid: ' + txid);
    addLog('BTC sent: ' + txid, 'ok');
  }

  // ── Create UTXOs ──────────────────────────────────────────────────────────

  const utxoParams = () => ({
    upTo: true,
    num: utxoNum ? parseInt(utxoNum) : undefined,
    size: utxoSize ? parseInt(utxoSize) : undefined,
    feeRate: utxoFee ? parseFloat(utxoFee) : undefined,
  });

  async function handleUtxosBegin() {
    if (!utexo) { setUtxosOut('No UTEXOWallet active'); return; }
    addLog('createUtxosBegin...', 'info');
    const psbt = await utexo.createUtxosBegin(utxoParams());
    setUtxoPendingPsbt(psbt as string);
    setUtxoSignedPsbt(null);
    setUtxosOut('Step 1 — Unsigned PSBT:\n' + psbt);
    addLog('PSBT ready', 'ok');
  }

  async function handleUtxosSign() {
    if (!utexo || !utxoPendingPsbt) { setUtxosOut('Run Step 1 first'); return; }
    const signed = await utexo.signPsbt(utxoPendingPsbt);
    setUtxoSignedPsbt(signed);
    setUtxosOut('Step 2 — Signed PSBT:\n' + signed);
    addLog('PSBT signed', 'ok');
  }

  async function handleUtxosEnd() {
    if (!utexo || !utxoSignedPsbt) { setUtxosOut('Sign PSBT first'); return; }
    const result = await utexo.createUtxosEnd({ signedPsbt: utxoSignedPsbt });
    setUtxoPendingPsbt(null); setUtxoSignedPsbt(null);
    setUtxosOut('UTXOs created: ' + json(result));
    addLog('UTXOs created', 'ok');
  }

  async function handleUtxosAuto() {
    if (!utexo) { setUtxosOut('No UTEXOWallet active'); return; }
    addLog('createUtxos (auto)...', 'info');
    const result = await utexo.createUtxos(utxoParams());
    setUtxosOut('UTXOs created: ' + json(result));
    addLog('UTXOs created (auto)', 'ok');
  }

  // ── Issue NIA ─────────────────────────────────────────────────────────────

  async function handleIssueNia() {
    if (!utexo) { setNiaOut('No UTEXOWallet active'); return; }
    const ticker = niaTicker.trim().toUpperCase();
    const name = niaName.trim();
    const amounts = parseAmounts(niaAmounts);
    if (!ticker || !name || amounts.length === 0) { setNiaOut('Fill ticker, name, amounts'); return; }
    try {
      addLog('Issuing NIA ' + ticker + '...', 'info');
      const asset = await utexo.issueAssetNia({ ticker, name, precision: parseInt(niaPrecision) || 0, amounts });
      setNiaOut(json(asset));
      const id = (asset as { assetId?: string }).assetId ?? '';
      setAssetIdQuery(id);
      addLog('NIA issued: ' + id, 'ok');
    } catch (e) { setNiaOut('Error: ' + e); addLog('Issue NIA failed: ' + e, 'err'); }
  }

  // ── Issue IFA ─────────────────────────────────────────────────────────────

  async function handleIssueIfa() {
    if (!utexo) { setIfaOut('No UTEXOWallet active'); return; }
    const ticker = ifaTicker.trim().toUpperCase();
    const name = ifaName.trim();
    const amounts = parseAmounts(ifaAmounts);
    const inflationAmounts = parseAmounts(ifaInflationAmounts);
    if (!ticker || !name || amounts.length === 0) { setIfaOut('Fill ticker, name, amounts'); return; }
    try {
      addLog('Issuing IFA ' + ticker + '...', 'info');
      const asset = await utexo.issueAssetIfa({ ticker, name, precision: parseInt(ifaPrecision) || 0, amounts, inflationAmounts, replaceRightsNum: parseInt(ifaReplaceRights) || 0, rejectListUrl: null });
      setIfaOut(json(asset));
      addLog('IFA issued', 'ok');
    } catch (e) { setIfaOut('Error: ' + e); addLog('Issue IFA failed: ' + e, 'err'); }
  }

  // ── Receive ───────────────────────────────────────────────────────────────

  async function handleReceive() {
    if (!utexo) { setRecvOut('No UTEXOWallet active'); return; }
    const witness = recvWitness === 'true';
    try {
      addLog('onchainReceive (witness: ' + witness + ')...', 'info');
      const result = await utexo.onchainReceive({
        assetId: recvAssetId.trim(),
        amount: recvAmount ? parseInt(recvAmount) : 0,
        durationSeconds: recvDuration ? parseInt(recvDuration) : undefined,
        witness,
      });
      setRecvOut(json(result));
      setSendInvoice(result.invoice);
      addLog((witness ? 'Witness' : 'Blind') + ' receive invoice created', 'ok');
    } catch (e) { setRecvOut('Error: ' + e); }
  }

  // ── Send Assets ───────────────────────────────────────────────────────────

  const sendParams = () => ({
    invoice: sendInvoice.trim(),
    assetId: sendAssetId.trim() || undefined,
    amount: sendAmount ? parseInt(sendAmount) : undefined,
    donation: sendDonation === 'true',
    feeRate: parseFloat(sendFeeRate) || 2,
    // Witness invoices (recipient ID like bcrt:wvout:…) require witnessData;
    // blind invoices (…utxob:…) must NOT have it.
    witnessData: sendWitnessSats
      ? { amountSat: parseInt(sendWitnessSats) }
      : undefined,
  });

  async function handleSendBegin() {
    if (!utexo) { setSendOut('No UTEXOWallet active'); return; }
    if (!sendInvoice.trim()) { setSendOut('Enter recipient invoice'); return; }
    addLog('onchainSendBegin...', 'info');
    const psbt = await utexo.onchainSendBegin(sendParams());
    setSendPendingPsbt(psbt);
    setSendSignedPsbt(null);
    setSendOut('Step 1 — Unsigned PSBT:\n' + psbt);
    addLog('Send PSBT ready', 'ok');
  }

  async function handleSendSign() {
    if (!utexo || !sendPendingPsbt) { setSendOut('Run Step 1 first'); return; }
    const signed = await utexo.signPsbt(sendPendingPsbt);
    setSendSignedPsbt(signed);
    setSendOut('Step 2 — Signed PSBT:\n' + signed);
    addLog('Send PSBT signed', 'ok');
  }

  async function handleSendEnd() {
    if (!utexo || !sendSignedPsbt) { setSendOut('Sign PSBT first'); return; }
    addLog('onchainSendEnd (broadcast)...', 'info');
    const result = await utexo.onchainSendEnd({ signedPsbt: sendSignedPsbt });
    setSendPendingPsbt(null); setSendSignedPsbt(null);
    setSendOut('Result:\n' + json(result));
    addLog('Transfer submitted', 'ok');
  }

  async function handleSendAuto() {
    if (!utexo) { setSendOut('No UTEXOWallet active'); return; }
    if (!sendInvoice.trim()) { setSendOut('Enter recipient invoice'); return; }
    addLog('onchainSend (auto)...', 'info');
    const result = await utexo.onchainSend(sendParams());
    setSendOut('Result (auto):\n' + json(result));
    addLog('Transfer submitted (auto)', 'ok');
  }

  // ── Transactions & Transfers ──────────────────────────────────────────────

  async function handleListTransactions() {
    if (!utexo) { setTxOut('No UTEXOWallet active'); return; }
    try {
      const result = await utexo.listTransactions();
      setTxOut(json(result));
      addLog('Transactions: ' + (result?.length ?? 0), 'ok');
    } catch (e) { setTxOut('Error: ' + e); }
  }

  async function handleListTransfers() {
    if (!utexo) { setTxOut('No UTEXOWallet active'); return; }
    try {
      const result = await utexo.listTransfers(txAssetId.trim() || undefined);
      setTxOut(json(result));
      addLog('Transfers: ' + (result?.length ?? 0), 'ok');
    } catch (e) { setTxOut('Error: ' + e); }
  }

  async function handleFailTransfers() {
    if (!utexo) { setTxOut('No UTEXOWallet active'); return; }
    try {
      const batchIdx = failBatchIdx.trim() ? parseInt(failBatchIdx) : undefined;
      const result = await utexo.failTransfers({ batchTransferIdx: Number.isFinite(batchIdx) ? batchIdx : undefined });
      setTxOut('failTransfers: ' + json(result));
      addLog('failTransfers done', 'ok');
    } catch (e) { setTxOut('Error: ' + e); }
  }

  // ── Keys ──────────────────────────────────────────────────────────────────

  async function handleGetXpub() {
    if (!utexo) { setPubKeysOut('No UTEXOWallet active'); return; }
    try {
      const result = { network: utexo.getNetwork(), ...utexo.getXpub() };
      setPubKeysOut(json(result));
      addLog('Account xpubs retrieved', 'ok');
    } catch (e) { setPubKeysOut('Error: ' + e); }
  }

  // ── Lightning ─────────────────────────────────────────────────────────────

  async function handleCreateLightningInvoice() {
    if (!utexo) { setLnOut('No UTEXOWallet active'); return; }
    if (!lnAssetId.trim() || !lnAmount) { setLnOut('Enter asset ID and amount'); return; }
    try {
      addLog('createLightningInvoice...', 'info');
      const result = await utexo.createLightningInvoice({ asset: { assetId: lnAssetId.trim(), amount: parseInt(lnAmount) } });
      setLnOut(json(result));
      if (result?.lnInvoice) setLnInvoice(result.lnInvoice as string);
      addLog('Lightning invoice created', 'ok');
    } catch (e) { setLnOut('Error: ' + e); }
  }

  async function handlePayLn() {
    if (!utexo) { setLnPayOut('No UTEXOWallet active'); return; }
    if (!lnInvoice.trim()) { setLnPayOut('Enter LN invoice'); return; }
    try {
      addLog('payLightningInvoice...', 'info');
      const result = await utexo.payLightningInvoice({ lnInvoice: lnInvoice.trim(), assetId: lnSendAssetId.trim() || undefined, assetAmount: lnSendAmount ? parseInt(lnSendAmount) : undefined });
      setLnPayOut('Result:\n' + json(result));
      if (result?.txid) setLnPaymentHash(result.txid as string);
      addLog('LN pay complete', 'ok');
    } catch (e) { setLnPayOut('Error: ' + e); addLog('LN pay failed: ' + e, 'err'); }
  }

  async function handleGetLnSendStatus() {
    if (!utexo || !lnPaymentHash.trim()) { setLnStatusOut('Enter payment hash (returned as txid by payLightningInvoice)'); return; }
    try {
      const result = await utexo.getLightningSendRequest(lnPaymentHash.trim());
      setLnStatusOut('Status: ' + json(result));
    } catch (e) { setLnStatusOut('Error: ' + e); }
  }

  async function handleGetLnReceiveStatus() {
    if (!utexo || !lnInvoice.trim()) { setLnStatusOut('Enter LN invoice'); return; }
    try {
      const result = await utexo.getLightningReceiveRequest(lnInvoice.trim());
      setLnStatusOut('Status: ' + json(result));
    } catch (e) { setLnStatusOut('Error: ' + e); }
  }

  async function handleDecodeLnInvoice() {
    if (!utexo) { setLnStatusOut('No UTEXOWallet active'); return; }
    if (!lnInvoice.trim()) { setLnStatusOut('Enter LN invoice'); return; }
    try {
      const result = await utexo.decodeLnInvoice(lnInvoice.trim());
      setLnStatusOut(json(result));
      addLog('LN invoice decoded', 'ok');
    } catch (e) { setLnStatusOut('Error: ' + e); }
  }

  // ── Lightning node / peers / channels ─────────────────────────────────────
  const [lnPeerAddr, setLnPeerAddr] = useState('');
  const [lnPeerPubkey, setLnPeerPubkey] = useState('');
  const [lnPeersOut, setLnPeersOut] = useState('');

  const [chanPeerPubkey, setChanPeerPubkey] = useState('');
  const [chanCapacity, setChanCapacity] = useState('100000');
  const [chanPublic, setChanPublic] = useState('true');
  const [chanAssetId, setChanAssetId] = useState('');
  const [chanAssetAmount, setChanAssetAmount] = useState('');
  const [closeChannelId, setCloseChannelId] = useState('');
  const [closeForce, setCloseForce] = useState('false');
  const [chanOut, setChanOut] = useState('');

  async function handleGetNodeInfo() {
    if (!utexo) { setLnPeersOut('No UTEXOWallet active'); return; }
    try {
      const info = await utexo.getNodeInfo();
      setLnPeersOut(json(info));
      addLog('nodeInfo retrieved', 'ok');
    } catch (e) { setLnPeersOut('Error: ' + e); }
  }

  async function handleListPeers() {
    if (!utexo) { setLnPeersOut('No UTEXOWallet active'); return; }
    try {
      const peers = await utexo.listPeers();
      setLnPeersOut(json(peers));
      addLog('Peers: ' + peers.length, 'ok');
    } catch (e) { setLnPeersOut('Error: ' + e); }
  }

  async function handleConnectPeer() {
    if (!utexo) { setLnPeersOut('No UTEXOWallet active'); return; }
    if (!lnPeerAddr.trim() || !lnPeerPubkey.trim()) { setLnPeersOut('Enter peer address and pubkey'); return; }
    try {
      addLog('connectPeer...', 'info');
      await utexo.connectPeer(lnPeerAddr.trim(), lnPeerPubkey.trim());
      setLnPeersOut('Connected to ' + lnPeerPubkey.trim());
      addLog('connectPeer done', 'ok');
    } catch (e) { setLnPeersOut('Error: ' + e); addLog('connectPeer failed: ' + e, 'err'); }
  }

  async function handleDisconnectPeer() {
    if (!utexo) { setLnPeersOut('No UTEXOWallet active'); return; }
    if (!lnPeerPubkey.trim()) { setLnPeersOut('Enter peer pubkey'); return; }
    try {
      await utexo.disconnectPeer(lnPeerPubkey.trim());
      setLnPeersOut('Disconnected from ' + lnPeerPubkey.trim());
      addLog('disconnectPeer done', 'ok');
    } catch (e) { setLnPeersOut('Error: ' + e); }
  }

  async function handleOpenChannel() {
    if (!utexo) { setChanOut('No UTEXOWallet active'); return; }
    if (!chanPeerPubkey.trim()) { setChanOut('Enter peer pubkey'); return; }
    try {
      addLog('openChannel...', 'info');
      const tempChannelId = await utexo.openChannel({
        peerPubkey: chanPeerPubkey.trim(),
        capacitySat: BigInt(chanCapacity || '0'),
        isPublic: chanPublic === 'true',
        assetId: chanAssetId.trim() || undefined,
        assetLocalAmount: chanAssetAmount ? BigInt(chanAssetAmount) : undefined,
      });
      setChanOut('Channel opening. tempChannelId: ' + tempChannelId);
      addLog('openChannel done', 'ok');
    } catch (e) { setChanOut('Error: ' + e); addLog('openChannel failed: ' + e, 'err'); }
  }

  async function handleListChannels() {
    if (!utexo) { setChanOut('No UTEXOWallet active'); return; }
    try {
      const channels = await utexo.listChannels();
      setChanOut(json(channels));
      addLog('Channels: ' + channels.length, 'ok');
    } catch (e) { setChanOut('Error: ' + e); }
  }

  async function handleCloseChannel() {
    if (!utexo) { setChanOut('No UTEXOWallet active'); return; }
    if (!closeChannelId.trim()) { setChanOut('Enter channel ID'); return; }
    try {
      utexo.closeChannel(closeChannelId.trim(), undefined, closeForce === 'true');
      setChanOut('Close requested for channel: ' + closeChannelId.trim());
      addLog('closeChannel requested', 'ok');
    } catch (e) { setChanOut('Error: ' + e); }
  }

  // ── Validate Balance ──────────────────────────────────────────────────────

  async function handleValidateBalance() {
    if (!utexo) { setValidateOut('No UTEXOWallet active'); return; }
    if (!validateAssetId.trim() || !validateAmount) { setValidateOut('Enter asset ID and amount'); return; }
    try {
      addLog('validateBalance...', 'info');
      const bal = await utexo.getAssetBalance(validateAssetId.trim());
      const spendable = bal.spendable ?? 0;
      const need = parseInt(validateAmount);
      if (spendable < need) {
        throw new Error('insufficient spendable balance: ' + spendable + ' < ' + need);
      }
      setValidateOut('Balance valid — spendable ' + spendable + ' >= ' + validateAmount);
      addLog('Balance valid', 'ok');
    } catch (e) {
      setValidateOut('Validation failed: ' + e);
      addLog('validateBalance failed: ' + e, 'err');
    }
  }

  // ── Decode / Sign / Verify ────────────────────────────────────────────────

  async function handleDecodeInvoice() {
    if (!utexo) { setCryptoOut('No UTEXOWallet active'); return; }
    if (!decodeInvoice.trim()) { setCryptoOut('Enter an invoice'); return; }
    try {
      const result = await utexo.decodeRGBInvoice({ invoice: decodeInvoice.trim() });
      setCryptoOut(json(result));
      addLog('Invoice decoded', 'ok');
    } catch (e) { setCryptoOut('Error: ' + e); }
  }

  async function handleSignMessage() {
    if (!utexo) { setCryptoOut('No UTEXOWallet active'); return; }
    if (!signMsg.trim()) { setCryptoOut('Enter a message'); return; }
    try {
      const sig = await utexo.signMessage(signMsg.trim());
      setCryptoOut('Signature:\n' + sig);
      setVerifySig(sig);
      setVerifyMsg(signMsg.trim());
      addLog('Message signed', 'ok');
    } catch (e) { setCryptoOut('Error: ' + e); }
  }

  async function handleFundFaucet() {
    if (!utexo) { setFundOut('Switch to a UTEXOWallet wallet'); return; }
    try {
      addLog('Getting address for faucet...', 'info');
      const addr = await utexo.getAddress();
      const amount = parseInt(fundAmount) || 10000;
      const feeRate = parseInt(fundFeeRate) || 5;
      if (activeUtexoNetwork === 'regtest') {
        addLog('Funding ' + addr + ' with ' + amount + ' sats via gateway /dev/regtest/fund (+1 block)...', 'info');
        await gatewayRegtestFund(addr, amount / 1e8, 1);
        setFundOut('Funded ' + amount + ' sats via gateway (1 block mined). Run syncWallet to see the balance.');
      } else if (activeUtexoNetwork === 'utexo') {
        addLog('Funding ' + addr + ' with ' + amount + ' sats via UTEXO faucet node...', 'info');
        const result = await faucetSendBtc(UTEXO_FAUCET_URL, addr, amount, feeRate);
        setFundOut('Funded!\n' + json(result));
      } else {
        addLog('Funding ' + addr + ' with ' + amount + ' sats via thunderstack faucet...', 'info');
        const result = await faucetSendBtc(FAUCET_BASE_URL, addr, amount, feeRate, FAUCET_TOKEN);
        setFundOut('Funded!\n' + json(result));
      }
      addLog('Faucet funded: ' + amount + ' sats', 'ok');
    } catch (e) {
      setFundOut('Error: ' + e);
      addLog('Faucet failed: ' + e, 'err');
    }
  }

  async function handleVerifyMessage() {
    if (!utexo) { setCryptoOut('No UTEXOWallet active'); return; }
    if (!verifyMsg.trim() || !verifySig.trim()) { setCryptoOut('Enter message and signature'); return; }
    try {
      const valid = await utexo.verifyMessage(verifyMsg.trim(), verifySig.trim());
      setCryptoOut('Verification: ' + (valid ? 'VALID ✓' : 'INVALID ✗'));
      addLog('Verify: ' + valid, valid ? 'ok' : 'warn');
    } catch (e) { setCryptoOut('Error: ' + e); }
  }

  // ── LSP (utexo-lsp composed flows — mirrors the LSP & APay page) ──────────
  const [lsp, setLsp] = useState<UtexoLsp | null>(null);
  const [lspBaseUrl, setLspBaseUrl] = useState('');
  const [lspPeerPubkey, setLspPeerPubkey] = useState('');
  const [lspPeerHost, setLspPeerHost] = useState('');
  const [lspPeerPort, setLspPeerPort] = useState('9735');
  const [lspBearerToken, setLspBearerToken] = useState('');
  const [lspConnectOut, setLspConnectOut] = useState('');

  const [lspRecvAssetId, setLspRecvAssetId] = useState('');
  const [lspRecvSats, setLspRecvSats] = useState('3000');
  const [lspRecvRgb, setLspRecvRgb] = useState('100');
  const [lspRecvLnInvoice, setLspRecvLnInvoice] = useState('');
  const [lspRecvOut, setLspRecvOut] = useState('');

  const [lspSendRgbInvoice, setLspSendRgbInvoice] = useState('');
  const [lspSendOut, setLspSendOut] = useState('');

  const [payAddress, setPayAddress] = useState('');
  const [payAmtMsat, setPayAmtMsat] = useState('1000');
  const [payAssetId, setPayAssetId] = useState('');
  const [payAssetAmount, setPayAssetAmount] = useState('');
  const [payOut, setPayOut] = useState('');

  const [apayHostNodeId, setApayHostNodeId] = useState('');
  const [apayUsername, setApayUsername] = useState('');
  const [apayDomain, setApayDomain] = useState('');
  const [apayOut, setApayOut] = useState('');

  // Prefill the LSP peer fields with the local regtest stack config (same
  // values the APay flow uses) whenever the active wallet is regtest.
  useEffect(() => {
    if (activeUtexoNetwork !== 'regtest') return;
    setLspBaseUrl((v) => v || REGTEST_LSP_CFG.lspBaseUrl);
    setLspPeerPubkey((v) => v || REGTEST_LSP_CFG.lspPubkey);
    setLspPeerHost((v) => v || '127.0.0.1');
    setLspPeerPort(String(REGTEST_LSP_CFG.lspPort));
    setLspRecvAssetId((v) => v || REGTEST_LSP_CFG.assetId);
  }, [activeUtexoNetwork]);

  function requireLsp(set: (s: string) => void): UtexoLsp | null {
    if (!lsp) {
      set('Create / connect to the LSP first (section 22).');
      return null;
    }
    return lsp;
  }

  async function handleCreateLsp() {
    if (!utexo) return setLspConnectOut('No UTEXOWallet active');
    try {
      addLog('Creating UtexoLsp...', 'info');
      let instance: UtexoLsp;
      if (lspPeerPubkey.trim() && lspPeerHost.trim()) {
        const peer: LspPeer = {
          baseUrl: lspBaseUrl.trim(),
          peerPubkey: lspPeerPubkey.trim(),
          peerHost: lspPeerHost.trim(),
          peerPort: parseInt(lspPeerPort) || 9735,
          bearerToken: lspBearerToken.trim() || undefined,
        };
        instance = await utexo.createLsp(peer);
      } else {
        // Auto-discover the peer from the wallet's configured lspBaseUrl via GET /get_info.
        instance = await utexo.createLsp(undefined, parseInt(lspPeerPort) || 9735);
      }
      setLsp(instance);
      setLspConnectOut('UtexoLsp ready\npeer: ' + json(instance.peer));
      addLog('UtexoLsp created', 'ok');
    } catch (e) {
      setLspConnectOut('Error: ' + e);
      addLog('createLsp failed: ' + e, 'err');
    }
  }

  async function handleLspConnect() {
    const l = requireLsp(setLspConnectOut);
    if (!l) return;
    try {
      addLog('Connecting to LSP peer...', 'info');
      await l.connect();
      const info = await l.http.getInfo();
      setLspConnectOut('Connected.\nLSP get_info:\n' + json(info));
      addLog('Connected to LSP', 'ok');
    } catch (e) {
      setLspConnectOut('Error: ' + e);
      addLog('connect failed: ' + e, 'err');
    }
  }

  async function handleLspReceiveAsset() {
    const l = requireLsp(setLspRecvOut);
    if (!l) return;
    if (!lspRecvAssetId.trim()) return setLspRecvOut('Enter asset ID');
    try {
      addLog('LSP receiveAsset...', 'info');
      const res = await l.receiveAsset({
        assetId: lspRecvAssetId.trim(),
        amountSats: parseInt(lspRecvSats) || 0,
        amountRgb: parseInt(lspRecvRgb) || 0,
      });
      setLspRecvLnInvoice(res.lnInvoice);
      setLspRecvOut(json(res));
      addLog('receiveAsset ok — share rgbInvoice with the sender', 'ok');
    } catch (e) {
      setLspRecvOut('Error: ' + e);
      addLog('receiveAsset failed: ' + e, 'err');
    }
  }

  async function handleLspAwaitSettlement() {
    const l = requireLsp(setLspRecvOut);
    if (!l) return;
    if (!lspRecvLnInvoice.trim()) return setLspRecvOut('No LN invoice — run receiveAsset first');
    try {
      addLog('Awaiting receive settlement...', 'info');
      const outcome = await l.awaitReceiveSettlement(lspRecvLnInvoice.trim(), {
        onProgress: (s) => addLog('settlement: ' + s, 'info'),
      });
      setLspRecvOut('Settlement outcome: ' + outcome);
      addLog('awaitReceiveSettlement: ' + outcome, outcome === 'settled' ? 'ok' : 'warn');
    } catch (e) {
      setLspRecvOut('Error: ' + e);
      addLog('awaitReceiveSettlement failed: ' + e, 'err');
    }
  }

  async function handleLspSendAsset() {
    const l = requireLsp(setLspSendOut);
    if (!l) return;
    if (!lspSendRgbInvoice.trim()) return setLspSendOut('Enter the recipient RGB invoice');
    try {
      addLog('LSP sendAsset...', 'info');
      const res = await l.sendAsset({ rgbInvoice: lspSendRgbInvoice.trim() });
      setLspSendOut(json(res));
      addLog('sendAsset ok', 'ok');
    } catch (e) {
      setLspSendOut('Error: ' + e);
      addLog('sendAsset failed: ' + e, 'err');
    }
  }

  async function handlePayAddress() {
    const l = requireLsp(setPayOut);
    if (!l) return;
    if (!payAddress.trim()) return setPayOut('Enter a Lightning Address');
    try {
      addLog('Paying Lightning Address ' + payAddress + '...', 'info');
      const asset = payAssetId.trim()
        ? { assetId: payAssetId.trim(), assetAmount: parseInt(payAssetAmount) || 0 }
        : undefined;
      const res = await l.payAddress({
        address: payAddress.trim(),
        amtMsat: parseInt(payAmtMsat) || 0,
        asset,
      });
      setPayOut(json(res));
      addLog('payAddress ok', 'ok');
    } catch (e) {
      setPayOut('Error: ' + e);
      addLog('payAddress failed: ' + e, 'err');
    }
  }

  async function handleEnableLightningAddress() {
    const l = requireLsp(setApayOut);
    if (!l) return;
    try {
      addLog('enableLightningAddress (APay)...', 'info');
      const info = await l.enableLightningAddress();
      setApayUsername(info.username);
      setApayDomain(info.domain);
      setApayOut(json(info));
      addLog('Lightning Address enabled: ' + info.address, 'ok');
    } catch (e) {
      setApayOut('Error: ' + e);
      addLog('enableLightningAddress failed: ' + e, 'err');
    }
  }

  async function handleRefillHashPool() {
    const l = requireLsp(setApayOut);
    if (!l) return;
    try {
      addLog('refillHashPool...', 'info');
      const res = await l.refillHashPool();
      setApayOut(json(res));
      addLog('refillHashPool ok — unused hashes: ' + res.unusedHashes, 'ok');
    } catch (e) {
      setApayOut('Error: ' + e);
      addLog('refillHashPool failed: ' + e, 'err');
    }
  }

  async function handleClaimPending() {
    const l = requireLsp(setApayOut);
    if (!l) return;
    try {
      addLog('claimPendingPayments...', 'info');
      const res = await l.claimPendingPayments();
      setApayOut(json(res));
      addLog('claimPendingPayments: ' + res.length + ' processed', 'ok');
    } catch (e) {
      setApayOut('Error: ' + e);
      addLog('claimPendingPayments failed: ' + e, 'err');
    }
  }

  async function handleApayNew() {
    if (!utexo) return setApayOut('No UTEXOWallet active');
    if (!apayHostNodeId.trim()) return setApayOut('Enter host node id');
    try {
      addLog('apayNew...', 'info');
      const res = await utexo.apayNew(apayHostNodeId.trim());
      setApayOut(json(res));
      addLog('apayNew ok', 'ok');
    } catch (e) {
      setApayOut('Error: ' + e);
      addLog('apayNew failed: ' + e, 'err');
    }
  }

  async function handleApayNewWithAddress() {
    if (!utexo) return setApayOut('No UTEXOWallet active');
    if (!apayHostNodeId.trim() || !apayUsername.trim() || !apayDomain.trim()) {
      return setApayOut('Enter host node id, username and domain');
    }
    try {
      addLog('apayNewWithAddress...', 'info');
      const res = await utexo.apayNewWithAddress(
        apayHostNodeId.trim(),
        apayUsername.trim(),
        apayDomain.trim()
      );
      setApayOut(json(res));
      addLog('apayNewWithAddress ok', 'ok');
    } catch (e) {
      setApayOut('Error: ' + e);
      addLog('apayNewWithAddress failed: ' + e, 'err');
    }
  }

  return (
    <div className="flex items-start gap-6">
      {/* ── Function navigation (sticky left sidebar) ─────────────────────── */}
      <nav className="hidden sm:block w-44 shrink-0 sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto bg-[#161b22] border border-[#30363d] rounded-lg p-1.5">
        {SECTION_NAV.map((g) => (
          <div key={g.group} className="mb-1 last:mb-0">
            <div className="px-2 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-[#484f58]">{g.group}</div>
            {g.items.map((s) => (
              <button
                key={s.id}
                onClick={() => scrollToSection(s.id)}
                className={
                  'block w-full text-left px-2 py-1 rounded text-xs whitespace-nowrap ' +
                  (activeSection === s.id
                    ? 'bg-[#0d1117] text-[#58a6ff] font-semibold'
                    : 'text-[#8b949e] hover:text-[#58a6ff] hover:bg-[#0d1117]')
                }
              >
                {s.label}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="flex-1 min-w-0">
      <h1 className="text-[#58a6ff] text-2xl font-bold mb-1">UTEXOWallet</h1>
      <p className="text-[#8b949e] text-sm mb-8">
        Full UTEXOWallet lifecycle — create, fund, issue assets, send/receive RGB, onchain bridge, Lightning
        <span className="ml-2 text-xs px-2 py-0.5 rounded bg-[#161b22] border border-[#30363d] text-[#8b949e]">RLN-backed · regtest / utexo / signet / testnet / mainnet</span>
      </p>

      <GroupHeading>Onchain</GroupHeading>

      {/* ── Create Wallet ─────────────────────────────────────────────────── */}
      <Section id="sec-create" title="1. Create UTEXOWallet" hint="new UTEXOWallet({ mnemonic, password, network, indexerUrl?, transportEndpoint? }) + await init() — auto-connects; URLs default per network when blank">
        <div className="flex gap-4 mb-4 flex-wrap">
          <Field label="Network">
            <select value={network} onChange={(e) => setNetwork(e.target.value as UtexoNetwork)} className={selectCls}>
              {UTEXO_NETWORKS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
          <Field label="Label (optional)">
            <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls} placeholder='e.g. "Alice"' />
          </Field>
          <Field label="SDK Password">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} placeholder="RLN SDK password" />
          </Field>
        </div>
        <Field label="Transport Endpoint (optional — blank = network default; RGB consignment delivery)">
          <input value={transportEndpoint} onChange={(e) => setTransportEndpoint(e.target.value)} className={inputCls} placeholder={getRlnTransportEndpoint(network) || 'e.g. http://127.0.0.1:3001/rgb/json-rpc'} />
        </Field>
        <Field label="LN Gateway proxyUrl (optional — blank = network default; enables the Lightning node)">
          <input value={proxyUrl} onChange={(e) => setProxyUrl(e.target.value)} className={inputCls} placeholder={getRlnProxyUrl(network) || 'e.g. ws://127.0.0.1:3001'} />
        </Field>
        <Field label="Mnemonic">
          <textarea value={mnemonic} onChange={(e) => setMnemonic(e.target.value)} className={textareaCls} rows={2} placeholder="Enter 12/24-word mnemonic or click Generate" />
        </Field>
        <div className="flex gap-2 mb-4 flex-wrap">
          <Btn variant="secondary" onClick={handleGenMnemonic} disabled={creating}>Generate Mnemonic</Btn>
          <Btn onClick={handleCreate} disabled={creating}>{creating ? 'Creating...' : 'Create UTEXOWallet'}</Btn>
        </div>
        <OutputBox value={createOut} />
      </Section>

      {/* ── Active Wallet Info ────────────────────────────────────────────── */}
      {activeWallet?.type === 'utexo' && (
        <Section title={'Active: ' + activeWallet.label}>
          <div className="bg-[#161b22] border border-[#30363d] rounded p-4 font-mono text-xs leading-relaxed space-y-1 mb-4">
            <div><span className="text-[#8b949e]">network:</span> <span className="text-[#c9d1d9]">{activeWallet.config.network}</span></div>
            <div><span className="text-[#8b949e]">online:</span> <span className={activeWallet.online ? 'text-[#3fb950]' : 'text-[#484f58]'}>{activeWallet.online ? 'yes' : 'no'}</span></div>
            {activeWallet.config.indexerUrl && (
              <div><span className="text-[#8b949e]">indexer:</span> <span className="text-[#c9d1d9]">{activeWallet.config.indexerUrl}</span></div>
            )}
            <div className="pt-1">
              <button onClick={() => setShowMnemonic((v) => !v)} className="text-[#8b949e] hover:text-[#58a6ff] text-xs underline">
                {showMnemonic ? 'hide mnemonic' : 'show mnemonic'}
              </button>
              {showMnemonic && <div className="mt-1 text-[#d29922] break-words">{activeWallet.config.mnemonic}</div>}
            </div>
          </div>
          <Btn variant="danger" onClick={handleRemoveWallet}>Remove Wallet</Btn>
        </Section>
      )}

      {/* ── Go Online ─────────────────────────────────────────────────────── */}
      <Section id="sec-online" title="2. goOnline()" hint="Retry the indexer connection — init() already auto-connects, so this is only needed if the wallet shows offline.">
        {utexoWarn}
        <Field label="Indexer URL">
          <input value={indexerUrl} onChange={(e) => setIndexerUrl(e.target.value)} className={inputCls} placeholder={getIndexerUrl(network)} />
        </Field>
        <Btn variant="accent" onClick={handleGoOnline} disabled={!utexo}>Go Online</Btn>
        <OutputBox value={onlineOut} />
      </Section>

      {/* ── Wallet Info ───────────────────────────────────────────────────── */}
      <Section id="sec-info" title="3. Wallet Info" hint="getAddress · getBtcBalance · listUnspents · listAssets · getAssetBalance">
        {utexoWarn}
        <div className="flex gap-2 flex-wrap mb-2">
          <Btn onClick={handleGetAddress} disabled={!utexo}>getAddress()</Btn>
          <Btn onClick={handleGetBalance} disabled={!utexo}>getBtcBalance()</Btn>
          <Btn variant="secondary" onClick={handleListUnspents} disabled={!utexo}>listUnspents()</Btn>
        </div>
        <OutputBox value={infoOut} />
      </Section>

      {/* ── Fund ──────────────────────────────────────────────────────────── */}
      <Section id="sec-fund" title="4. Fund Wallet" hint="utexo → UTEXO faucet node (rln-signet.utexo.com/faucet) · regtest → local gateway /dev/regtest/fund · testnet → thunderstack faucet">
        {utexoWarn}
        {utexo && !fundSupported && (
          <p className="text-xs text-[#d29922] mb-3">Faucet funding is available on utexo, regtest and testnet wallets.</p>
        )}
        <div className="flex gap-4 mb-4 flex-wrap">
          <Field label="Amount (sats)">
            <input type="number" value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} className={inputCls} min="1000" max="100000" />
          </Field>
          <Field label="Fee rate (sat/vB)">
            <input type="number" value={fundFeeRate} onChange={(e) => setFundFeeRate(e.target.value)} className={inputCls} min="1" />
          </Field>
        </div>
        <Btn variant="accent" onClick={handleFundFaucet} disabled={!utexo || !fundSupported}>Fund via Faucet</Btn>
        <OutputBox value={fundOut} />
      </Section>

      {/* ── BTC Send ──────────────────────────────────────────────────────── */}
      <Section id="sec-send-btc" title="5. Send BTC" hint="sendBtcBegin → signPsbt → sendBtcEnd (or sendBtc for one-shot)">
        {utexoWarn}
        <div className="flex gap-4 mb-4 flex-wrap">
          <Field label="Recipient address">
            <input value={btcAddress} onChange={(e) => setBtcAddress(e.target.value)} className={inputCls} placeholder="tb1q..." />
          </Field>
          <Field label="Amount (sats)">
            <input type="number" value={btcAmount} onChange={(e) => setBtcAmount(e.target.value)} className={inputCls} placeholder="10000" min="546" />
          </Field>
          <Field label="Fee rate (sat/vB)">
            <input type="number" value={btcFeeRate} onChange={(e) => setBtcFeeRate(e.target.value)} className={inputCls} step="0.1" min="1" />
          </Field>
        </div>
        <StepFlow
          steps={[
            { label: '1. sendBtcBegin()', onClick: handleBtcBegin },
            { label: '2. signPsbt()', variant: 'warning', onClick: handleBtcSign },
            { label: '3. sendBtcEnd()', variant: 'accent', onClick: handleBtcEnd },
          ]}
          auto={{ label: 'sendBtc() auto', onClick: handleBtcAuto }}
          disabled={!utexo}
        />
        <OutputBox value={btcOut} />
      </Section>

      {/* ── Create UTXOs ──────────────────────────────────────────────────── */}
      <Section id="sec-utxos" title="6. Create UTXOs" hint="Allocate colored UTXOs for RGB transfers. createUtxosBegin → signPsbt → createUtxosEnd">
        {utexoWarn}
        <div className="flex gap-4 mb-4 flex-wrap">
          <Field label="num (optional)">
            <input type="number" value={utxoNum} onChange={(e) => setUtxoNum(e.target.value)} className={inputCls} placeholder="e.g. 1" min="1" />
          </Field>
          <Field label="size in sats (optional)">
            <input type="number" value={utxoSize} onChange={(e) => setUtxoSize(e.target.value)} className={inputCls} placeholder="e.g. 1000" min="1" />
          </Field>
          <Field label="fee rate (optional)">
            <input type="number" value={utxoFee} onChange={(e) => setUtxoFee(e.target.value)} className={inputCls} placeholder="e.g. 1.5" step="0.1" />
          </Field>
        </div>
        <StepFlow
          steps={[
            { label: '1. createUtxosBegin()', onClick: handleUtxosBegin },
            { label: '2. signPsbt()', variant: 'warning', onClick: handleUtxosSign },
            { label: '3. createUtxosEnd()', variant: 'accent', onClick: handleUtxosEnd },
          ]}
          auto={{ label: 'createUtxos() auto', onClick: handleUtxosAuto }}
          disabled={!utexo}
        />
        <OutputBox value={utxosOut} />
      </Section>

      {/* ── Sync ──────────────────────────────────────────────────────────── */}
      <Section id="sec-sync" title="7. Sync" hint="syncWallet() — sync BTC/UTXO state. refreshWallet() — refresh pending RGB transfers.">
        {utexoWarn}
        <div className="flex gap-2 flex-wrap">
          <Btn onClick={handleSync} disabled={!utexo}>syncWallet()</Btn>
          <Btn variant="secondary" onClick={handleRefresh} disabled={!utexo}>refreshWallet()</Btn>
        </div>
        <OutputBox value={syncOut} />
      </Section>

      {/* ── Issue NIA ─────────────────────────────────────────────────────── */}
      <Section id="sec-nia" title="8. Issue NIA Asset" hint="issueAssetNia() — Non-Inflatable Asset (fixed supply fungible token)">
        {utexoWarn}
        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="Ticker">
            <input value={niaTicker} onChange={(e) => setNiaTicker(e.target.value)} className={inputCls} maxLength={8} style={{ textTransform: 'uppercase' }} />
          </Field>
          <Field label="Name">
            <input value={niaName} onChange={(e) => setNiaName(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <div className="flex gap-4 mb-4 flex-wrap">
          <Field label="Precision">
            <input type="number" value={niaPrecision} onChange={(e) => setNiaPrecision(e.target.value)} className={inputCls} min="0" max="18" />
          </Field>
          <Field label="Amounts (comma-separated)">
            <input value={niaAmounts} onChange={(e) => setNiaAmounts(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <Btn onClick={handleIssueNia} disabled={!utexo}>issueAssetNia()</Btn>
        <OutputBox label="Issued NIA" value={niaOut} />
      </Section>

      {/* ── Issue IFA ─────────────────────────────────────────────────────── */}
      <Section id="sec-ifa" title="9. Issue IFA Asset" hint="issueAssetIfa() — Inflatable Fungible Asset (supply can be increased)">
        {utexoWarn}
        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="Ticker">
            <input value={ifaTicker} onChange={(e) => setIfaTicker(e.target.value)} className={inputCls} maxLength={8} style={{ textTransform: 'uppercase' }} />
          </Field>
          <Field label="Name">
            <input value={ifaName} onChange={(e) => setIfaName(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="Precision">
            <input type="number" value={ifaPrecision} onChange={(e) => setIfaPrecision(e.target.value)} className={inputCls} min="0" max="18" />
          </Field>
          <Field label="Initial amounts (comma-separated)">
            <input value={ifaAmounts} onChange={(e) => setIfaAmounts(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <div className="flex gap-4 mb-4 flex-wrap">
          <Field label="Inflation amounts (comma-separated)">
            <input value={ifaInflationAmounts} onChange={(e) => setIfaInflationAmounts(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Replace rights num">
            <input type="number" value={ifaReplaceRights} onChange={(e) => setIfaReplaceRights(e.target.value)} className={inputCls} min="0" />
          </Field>
        </div>
        <Btn onClick={handleIssueIfa} disabled={!utexo}>issueAssetIfa()</Btn>
        <OutputBox label="Issued IFA" value={ifaOut} />
      </Section>

      {/* ── List Assets ───────────────────────────────────────────────────── */}
      <Section id="sec-assets" title="10. List Assets" hint="listAssets() · getAssetBalance(assetId)">
        {utexoWarn}
        <div className="flex gap-2 flex-wrap mb-4">
          <Btn onClick={handleListAssets} disabled={!utexo}>listAssets()</Btn>
        </div>
        <div className="flex gap-4 items-end flex-wrap">
          <Field label="Asset ID">
            <input value={assetIdQuery} onChange={(e) => setAssetIdQuery(e.target.value)} className={inputCls} placeholder="rgb:..." />
          </Field>
          <Btn variant="secondary" onClick={handleGetAssetBalance} disabled={!utexo} className="mb-4">getAssetBalance()</Btn>
        </div>
        <OutputBox value={listOut} />
      </Section>

      {/* ── Receive RGB ───────────────────────────────────────────────────── */}
      <Section id="sec-receive" title="11. Receive RGB Assets" hint="onchainReceive({ assetId?, amount?, witness }) — RLN rgb_invoice parity: one call, witness (default) or blind via the flag. Share the invoice (rgb:…) with the sender, not the recipientId.">
        {utexoWarn}
        <div className="flex gap-4 mb-4 flex-wrap">
          <Field label="Asset ID (optional)">
            <input value={recvAssetId} onChange={(e) => setRecvAssetId(e.target.value)} className={inputCls} placeholder="rgb:..." />
          </Field>
          <Field label="Amount (optional)">
            <input type="number" value={recvAmount} onChange={(e) => setRecvAmount(e.target.value)} className={inputCls} placeholder="100" min="1" />
          </Field>
          <Field label="Duration seconds (optional)">
            <input type="number" value={recvDuration} onChange={(e) => setRecvDuration(e.target.value)} className={inputCls} placeholder="3600" min="60" />
          </Field>
          <Field label="Receive mode">
            <select value={recvWitness} onChange={(e) => setRecvWitness(e.target.value)} className={selectCls}>
              <option value="true">witness (default)</option>
              <option value="false">blind</option>
            </select>
          </Field>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Btn onClick={handleReceive} disabled={!utexo}>onchainReceive()</Btn>
        </div>
        <OutputBox label="Invoice" value={recvOut} />
      </Section>

      {/* ── Send RGB ──────────────────────────────────────────────────────── */}
      <Section id="sec-send-rgb" title="12. Send RGB Assets" hint="onchainSendBegin → signPsbt → onchainSendEnd (or onchainSend() for one-shot) — the canonical RGB send, RN-parity names">
        {utexoWarn}
        <Field label="Recipient invoice (full rgb:… string — not the bcrt:/tb: recipient ID)">
          <input value={sendInvoice} onChange={(e) => setSendInvoice(e.target.value)} className={inputCls} placeholder="rgb:..." />
        </Field>
        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="Asset ID (optional)">
            <input value={sendAssetId} onChange={(e) => setSendAssetId(e.target.value)} className={inputCls} placeholder="rgb:..." />
          </Field>
          <Field label="Amount (optional)">
            <input type="number" value={sendAmount} onChange={(e) => setSendAmount(e.target.value)} className={inputCls} placeholder="100" min="1" />
          </Field>
          <Field label="Fee rate (sat/vB)">
            <input type="number" value={sendFeeRate} onChange={(e) => setSendFeeRate(e.target.value)} className={inputCls} step="0.1" min="1" />
          </Field>
          <Field label="Donation mode">
            <select value={sendDonation} onChange={(e) => setSendDonation(e.target.value)} className={selectCls}>
              <option value="false">No</option>
              <option value="true">Yes (send all)</option>
            </select>
          </Field>
          <Field label="Witness sats (required for witness invoices)">
            <input type="number" value={sendWitnessSats} onChange={(e) => setSendWitnessSats(e.target.value)} className={inputCls} placeholder="e.g. 1000" min="294" />
          </Field>
        </div>
        <StepFlow
          steps={[
            { label: '1. onchainSendBegin()', onClick: handleSendBegin },
            { label: '2. signPsbt()', variant: 'warning', onClick: handleSendSign },
            { label: '3. onchainSendEnd()', variant: 'accent', onClick: handleSendEnd },
          ]}
          auto={{ label: 'onchainSend() auto', onClick: handleSendAuto }}
          disabled={!utexo}
        />
        <OutputBox value={sendOut} />
      </Section>

      {/* ── Transactions & Transfers ──────────────────────────────────────── */}
      <Section id="sec-transfers" title="13. Transactions & Transfers" hint="listTransactions · listTransfers(assetId?) · failTransfers() — listOnchainTransfers() is an alias of listTransfers()">
        {utexoWarn}
        <div className="flex gap-4 mb-4 items-end flex-wrap">
          <Field label="Asset ID (optional, for listTransfers)">
            <input value={txAssetId} onChange={(e) => setTxAssetId(e.target.value)} className={inputCls} placeholder="rgb:..." />
          </Field>
          <Field label="Batch idx (optional, for failTransfers)">
            <input type="number" value={failBatchIdx} onChange={(e) => setFailBatchIdx(e.target.value)} className={inputCls} placeholder="e.g. 0" min="0" />
          </Field>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Btn onClick={handleListTransactions} disabled={!utexo}>listTransactions()</Btn>
          <Btn variant="secondary" onClick={handleListTransfers} disabled={!utexo}>listTransfers()</Btn>
          <Btn variant="danger" onClick={handleFailTransfers} disabled={!utexo}>failTransfers()</Btn>
        </div>
        <OutputBox value={txOut} />
      </Section>

      {/* ── Keys ──────────────────────────────────────────────────────────── */}
      <Section id="sec-keys" title="14. Keys" hint="getXpub() — vanilla + colored account xpubs · getNetwork()">
        {utexoWarn}
        <div className="flex gap-4 items-end flex-wrap">
          <Btn onClick={handleGetXpub} disabled={!utexo} className="mb-4">getXpub() + getNetwork()</Btn>
        </div>
        <OutputBox value={pubKeysOut} />
      </Section>

      {/* ── Validate Balance ──────────────────────────────────────────────── */}
      <Section id="sec-validate" title="15. Validate Balance" hint="Demo-side check via getAssetBalance() — the SDK has no validateBalance() method">
        {utexoWarn}
        <div className="flex gap-4 items-end flex-wrap">
          <Field label="Asset ID">
            <input value={validateAssetId} onChange={(e) => setValidateAssetId(e.target.value)} className={inputCls} placeholder="rgb:..." />
          </Field>
          <Field label="Amount">
            <input type="number" value={validateAmount} onChange={(e) => setValidateAmount(e.target.value)} className={inputCls} placeholder="100" min="1" />
          </Field>
          <Btn onClick={handleValidateBalance} disabled={!utexo} className="mb-4">Check spendable balance</Btn>
        </div>
        <OutputBox value={validateOut} />
      </Section>

      {/* ── Decode / Sign / Verify ────────────────────────────────────────── */}
      <Section id="sec-crypto" title="16. Decode / Sign / Verify" hint="decodeRGBInvoice · signMessage · verifyMessage">
        {utexoWarn}
        <Field label="RGB invoice to decode">
          <input value={decodeInvoice} onChange={(e) => setDecodeInvoice(e.target.value)} className={inputCls} placeholder="rgb:..." />
        </Field>
        <Btn variant="secondary" onClick={handleDecodeInvoice} disabled={!utexo} className="mb-4">decodeRGBInvoice()</Btn>

        <Field label="Message to sign">
          <input value={signMsg} onChange={(e) => setSignMsg(e.target.value)} className={inputCls} placeholder="Hello, UTEXO!" />
        </Field>
        <Btn variant="secondary" onClick={handleSignMessage} disabled={!utexo} className="mb-4">signMessage()</Btn>

        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="Message to verify">
            <input value={verifyMsg} onChange={(e) => setVerifyMsg(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Signature">
            <input value={verifySig} onChange={(e) => setVerifySig(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <Btn variant="secondary" onClick={handleVerifyMessage} disabled={!utexo} className="mb-4">verifyMessage()</Btn>

        <OutputBox value={cryptoOut} />
      </Section>

      <GroupHeading>Lightning</GroupHeading>

      {/* ── LN Node & Peers ───────────────────────────────────────────────── */}
      <Section id="sec-ln-peers" title="17. Node & Peers" hint="getNodeInfo · listPeers · connectPeer(peerAddr, peerPubkey) · disconnectPeer(peerPubkey)">
        {utexoWarn}
        <div className="flex gap-2 flex-wrap mb-4">
          <Btn onClick={handleGetNodeInfo} disabled={!utexo}>getNodeInfo()</Btn>
          <Btn variant="secondary" onClick={handleListPeers} disabled={!utexo}>listPeers()</Btn>
        </div>
        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="Peer address (host:port)">
            <input value={lnPeerAddr} onChange={(e) => setLnPeerAddr(e.target.value)} className={inputCls} placeholder="127.0.0.1:9735" />
          </Field>
          <Field label="Peer pubkey">
            <input value={lnPeerPubkey} onChange={(e) => setLnPeerPubkey(e.target.value)} className={inputCls} placeholder="02abc..." />
          </Field>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Btn onClick={handleConnectPeer} disabled={!utexo}>connectPeer()</Btn>
          <Btn variant="danger" onClick={handleDisconnectPeer} disabled={!utexo}>disconnectPeer()</Btn>
        </div>
        <OutputBox value={lnPeersOut} />
      </Section>

      {/* ── LN Channels ───────────────────────────────────────────────────── */}
      <Section id="sec-ln-channels" title="18. Channels" hint="openChannel({ peerPubkey, capacitySat, isPublic, assetId?, assetLocalAmount? }) · listChannels · closeChannel(channelId, force?)">
        {utexoWarn}
        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="Peer pubkey">
            <input value={chanPeerPubkey} onChange={(e) => setChanPeerPubkey(e.target.value)} className={inputCls} placeholder="02abc..." />
          </Field>
          <Field label="Capacity (sats)">
            <input type="number" value={chanCapacity} onChange={(e) => setChanCapacity(e.target.value)} className={inputCls} min="1" />
          </Field>
          <Field label="Public">
            <select value={chanPublic} onChange={(e) => setChanPublic(e.target.value)} className={selectCls}>
              <option value="true">yes</option>
              <option value="false">no</option>
            </select>
          </Field>
        </div>
        <div className="flex gap-4 mb-4 flex-wrap">
          <Field label="Asset ID (optional — RGB channel)">
            <input value={chanAssetId} onChange={(e) => setChanAssetId(e.target.value)} className={inputCls} placeholder="rgb:..." />
          </Field>
          <Field label="Asset local amount (optional)">
            <input type="number" value={chanAssetAmount} onChange={(e) => setChanAssetAmount(e.target.value)} className={inputCls} placeholder="100" min="1" />
          </Field>
        </div>
        <div className="flex gap-2 flex-wrap mb-4">
          <Btn onClick={handleOpenChannel} disabled={!utexo}>openChannel()</Btn>
          <Btn variant="secondary" onClick={handleListChannels} disabled={!utexo}>listChannels()</Btn>
        </div>
        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="Channel ID (for close)">
            <input value={closeChannelId} onChange={(e) => setCloseChannelId(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Force close">
            <select value={closeForce} onChange={(e) => setCloseForce(e.target.value)} className={selectCls}>
              <option value="false">no</option>
              <option value="true">yes (force)</option>
            </select>
          </Field>
        </div>
        <Btn variant="danger" onClick={handleCloseChannel} disabled={!utexo}>closeChannel()</Btn>
        <OutputBox value={chanOut} />
      </Section>

      {/* ── LN Create Invoice ─────────────────────────────────────────────── */}
      <Section id="sec-ln-invoice" title="19. Create Invoice" hint="createLightningInvoice({ asset }) — receive invoice via the embedded RLN node (requires channels; see the LSP sections below for zero-conf setup)">
        {utexoWarn}
        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="Asset ID">
            <input value={lnAssetId} onChange={(e) => setLnAssetId(e.target.value)} className={inputCls} placeholder="rgb:..." />
          </Field>
          <Field label="Amount">
            <input type="number" value={lnAmount} onChange={(e) => setLnAmount(e.target.value)} className={inputCls} placeholder="100" min="1" />
          </Field>
        </div>
        <Btn onClick={handleCreateLightningInvoice} disabled={!utexo}>createLightningInvoice()</Btn>
        <OutputBox value={lnOut} />
      </Section>

      {/* ── LN Pay Invoice ────────────────────────────────────────────────── */}
      <Section id="sec-ln-pay" title="20. Pay Invoice" hint="payLightningInvoice — atomic pay via the local RLN node (no begin/sign/end steps — the node signs internally)">
        {utexoWarn}
        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="LN invoice">
            <input value={lnInvoice} onChange={(e) => setLnInvoice(e.target.value)} className={inputCls} placeholder="lnbc1..." />
          </Field>
          <Field label="Asset ID (optional)">
            <input value={lnSendAssetId} onChange={(e) => setLnSendAssetId(e.target.value)} className={inputCls} placeholder="rgb:..." />
          </Field>
          <Field label="Asset amount (optional)">
            <input type="number" value={lnSendAmount} onChange={(e) => setLnSendAmount(e.target.value)} className={inputCls} placeholder="100" min="1" />
          </Field>
        </div>
        <Btn variant="accent" onClick={handlePayLn} disabled={!utexo}>payLightningInvoice()</Btn>
        <OutputBox value={lnPayOut} />
      </Section>

      {/* ── LN Status & Decode ────────────────────────────────────────────── */}
      <Section id="sec-ln-status" title="21. Payment Status & Decode" hint="getLightningSendRequest(paymentHash) · getLightningReceiveRequest(invoice) · decodeLnInvoice(invoice)">
        {utexoWarn}
        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="LN invoice (receive status / decode)">
            <input value={lnInvoice} onChange={(e) => setLnInvoice(e.target.value)} className={inputCls} placeholder="lnbc1..." />
          </Field>
          <Field label="Payment hash (send status — returned as txid)">
            <input value={lnPaymentHash} onChange={(e) => setLnPaymentHash(e.target.value)} className={inputCls} placeholder="hex payment hash" />
          </Field>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Btn variant="secondary" onClick={handleGetLnSendStatus} disabled={!utexo}>getLightningSendRequest()</Btn>
          <Btn variant="secondary" onClick={handleGetLnReceiveStatus} disabled={!utexo}>getLightningReceiveRequest()</Btn>
          <Btn variant="secondary" onClick={handleDecodeLnInvoice} disabled={!utexo}>decodeLnInvoice()</Btn>
        </div>
        <OutputBox value={lnStatusOut} />
      </Section>

      <GroupHeading>LSP</GroupHeading>

      {/* ── LSP: Create + Connect ─────────────────────────────────────────── */}
      <Section
        id="sec-lsp-connect"
        title="22. Create + Connect"
        hint="UTEXOWallet.createLsp() — leave peer fields blank to auto-discover from the wallet's lspBaseUrl (GET /get_info), which falls back to the network default (utexo → lsp-signet.utexo.com) when unset. On regtest the fields are prefilled from the local LSP stack config (.env.local)."
      >
        {utexoWarn}
        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="LSP Base URL (optional if wallet has lspBaseUrl)">
            <input value={lspBaseUrl} onChange={(e) => setLspBaseUrl(e.target.value)} className={inputCls} placeholder={(activeUtexoNetwork && getDefaultLspBaseUrl(activeUtexoNetwork)) || 'https://lsp.utexo.com'} />
          </Field>
          <Field label="Peer Port">
            <input value={lspPeerPort} onChange={(e) => setLspPeerPort(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="Peer Pubkey (optional — explicit peer)">
            <input value={lspPeerPubkey} onChange={(e) => setLspPeerPubkey(e.target.value)} className={inputCls} placeholder="leave blank to auto-discover" />
          </Field>
          <Field label="Peer Host (optional)">
            <input value={lspPeerHost} onChange={(e) => setLspPeerHost(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Bearer Token (APay routes)">
            <input value={lspBearerToken} onChange={(e) => setLspBearerToken(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <div className="flex gap-2 flex-wrap mb-2">
          <Btn onClick={handleCreateLsp} disabled={!utexo}>Create LSP</Btn>
          <Btn variant="accent" onClick={handleLspConnect} disabled={!lsp}>Connect + get_info</Btn>
        </div>
        <OutputBox value={lspConnectOut} />
      </Section>

      {/* ── LSP: Receive Asset ────────────────────────────────────────────── */}
      <Section id="sec-lsp-receive" title="23. Receive Asset (Lightning → RGB)" hint="receiveAsset() then awaitReceiveSettlement() — share the returned rgbInvoice with the on-chain sender.">
        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="Asset ID">
            <input value={lspRecvAssetId} onChange={(e) => setLspRecvAssetId(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Amount (sats)">
            <input value={lspRecvSats} onChange={(e) => setLspRecvSats(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Amount (RGB)">
            <input value={lspRecvRgb} onChange={(e) => setLspRecvRgb(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <div className="flex gap-2 flex-wrap mb-2">
          <Btn onClick={handleLspReceiveAsset} disabled={!lsp}>receiveAsset</Btn>
          <Btn variant="accent" onClick={handleLspAwaitSettlement} disabled={!lsp || !lspRecvLnInvoice}>awaitReceiveSettlement</Btn>
        </div>
        <OutputBox value={lspRecvOut} />
      </Section>

      {/* ── LSP: Send Asset ───────────────────────────────────────────────── */}
      <Section id="sec-lsp-send" title="24. Send Asset (RGB → Lightning)" hint="sendAsset() — submit the recipient's on-chain RGB invoice; the LSP returns a BOLT11 which the wallet pays.">
        <Field label="Recipient RGB Invoice">
          <input value={lspSendRgbInvoice} onChange={(e) => setLspSendRgbInvoice(e.target.value)} className={inputCls} placeholder="rgb:..." />
        </Field>
        <Btn onClick={handleLspSendAsset} disabled={!lsp} className="mb-2">sendAsset</Btn>
        <OutputBox value={lspSendOut} />
      </Section>

      {/* ── LSP: Pay Lightning Address ────────────────────────────────────── */}
      <Section id="sec-lsp-pay" title="25. Pay Lightning Address" hint="payAddress() — resolves the address (LNURL) and pays it.">
        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="Lightning Address">
            <input value={payAddress} onChange={(e) => setPayAddress(e.target.value)} className={inputCls} placeholder="alice@lsp.utexo.com" />
          </Field>
          <Field label="Amount (msat)">
            <input value={payAmtMsat} onChange={(e) => setPayAmtMsat(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="Asset ID (optional)">
            <input value={payAssetId} onChange={(e) => setPayAssetId(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Asset Amount (optional)">
            <input value={payAssetAmount} onChange={(e) => setPayAssetAmount(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <Btn onClick={handlePayAddress} disabled={!lsp} className="mb-2">payAddress</Btn>
        <OutputBox value={payOut} />
      </Section>

      {/* ── LSP: APay ─────────────────────────────────────────────────────── */}
      <Section id="sec-lsp-apay" title="26. APay — Lightning Address & Hash Pool" hint="enableLightningAddress() registers an attested hash batch; refill/claim manage the pool.">
        {utexoWarn}
        <div className="flex gap-2 flex-wrap mb-2">
          <Btn onClick={handleEnableLightningAddress} disabled={!lsp}>enableLightningAddress</Btn>
          <Btn variant="secondary" onClick={handleRefillHashPool} disabled={!lsp}>refillHashPool</Btn>
          <Btn variant="secondary" onClick={handleClaimPending} disabled={!lsp}>claimPendingPayments</Btn>
        </div>

        <p className="text-xs text-[#8b949e] mt-4 mb-2">Direct node calls (no LSP HTTP composition):</p>
        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="Host Node ID">
            <input value={apayHostNodeId} onChange={(e) => setApayHostNodeId(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Username">
            <input value={apayUsername} onChange={(e) => setApayUsername(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Domain">
            <input value={apayDomain} onChange={(e) => setApayDomain(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <div className="flex gap-2 flex-wrap mb-2">
          <Btn onClick={handleApayNew} disabled={!utexo}>apayNew</Btn>
          <Btn variant="secondary" onClick={handleApayNewWithAddress} disabled={!utexo}>apayNewWithAddress</Btn>
        </div>
        <OutputBox value={apayOut} />
      </Section>
      </div>
    </div>
  );
}
