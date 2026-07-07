import React, { useState, useEffect } from 'react';
import { generateKeys, UTEXOWallet } from '@utexo/rgb-sdk-web';
import { useStore } from '../store';
import type { WalletInstance, WalletConfig } from '../store';
import { Section } from '../components/Section';
import { Field, inputCls, selectCls, textareaCls } from '../components/Field';
import { Btn } from '../components/Btn';
import { OutputBox } from '../components/OutputBox';
import { StepFlow } from '../components/StepFlow';
import { useActiveWallet } from '../hooks/useActiveWallet';
import { json, getIndexerUrl, proxyIndexerUrl, parseAmounts, FAUCET_BASE_URL, FAUCET_TOKEN, UTEXO_FAUCET_URL, faucetSendBtc, gatewayRegtestFund } from '../lib/utils';
import { saveSessions, setUrlWallet } from '../lib/session';

let walletCounter = 0;
function nextId() {
  return 'utexo_' + (++walletCounter) + '_' + Date.now();
}

// All networks the RLN-backed UTEXOWallet supports (regtest/utexo have full
// URL defaults in the SDK — indexer, transport, LN gateway; see DEFAULT_RLN_URLS).
const UTEXO_NETWORKS = ['regtest', 'utexo', 'signet', 'testnet', 'mainnet'] as const;
type UtexoNetwork = typeof UTEXO_NETWORKS[number];

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
      // create() auto-connects — indexer/transport/proxy fall back to the
      // network defaults when the fields are left blank.
      const inst = await UTEXOWallet.create({
        mnemonic: mnemonic.trim(),
        password,
        network,
        transportEndpoint: transportEndpoint.trim() || undefined,
        proxyUrl: proxyUrl.trim() || undefined,
        indexerUrl: indexerUrl.trim() ? proxyIndexerUrl(indexerUrl.trim()) : undefined,
      });

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
    if (!utexo) { setLnOut('No UTEXOWallet active'); return; }
    if (!lnInvoice.trim()) { setLnOut('Enter LN invoice'); return; }
    try {
      addLog('payLightningInvoice...', 'info');
      const result = await utexo.payLightningInvoice({ lnInvoice: lnInvoice.trim(), assetId: lnSendAssetId.trim() || undefined, assetAmount: lnSendAmount ? parseInt(lnSendAmount) : undefined });
      setLnOut('Result:\n' + json(result));
      if (result?.txid) setLnPaymentHash(result.txid as string);
      addLog('LN pay complete', 'ok');
    } catch (e) { setLnOut('Error: ' + e); addLog('LN pay failed: ' + e, 'err'); }
  }

  async function handleGetLnSendStatus() {
    if (!utexo || !lnPaymentHash.trim()) { setLnOut('Enter payment hash (returned as txid by payLightningInvoice)'); return; }
    try {
      const result = await utexo.getLightningSendRequest(lnPaymentHash.trim());
      setLnOut('Status: ' + json(result));
    } catch (e) { setLnOut('Error: ' + e); }
  }

  async function handleGetLnReceiveStatus() {
    if (!utexo || !lnInvoice.trim()) { setLnOut('Enter LN invoice'); return; }
    try {
      const result = await utexo.getLightningReceiveRequest(lnInvoice.trim());
      setLnOut('Status: ' + json(result));
    } catch (e) { setLnOut('Error: ' + e); }
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

  return (
    <div>
      <h1 className="text-[#58a6ff] text-2xl font-bold mb-1">UTEXOWallet</h1>
      <p className="text-[#8b949e] text-sm mb-8">
        Full UTEXOWallet lifecycle — create, fund, issue assets, send/receive RGB, onchain bridge, Lightning
        <span className="ml-2 text-xs px-2 py-0.5 rounded bg-[#161b22] border border-[#30363d] text-[#8b949e]">RLN-backed · regtest / utexo / signet / testnet / mainnet</span>
      </p>

      {/* ── Create Wallet ─────────────────────────────────────────────────── */}
      <Section title="1. Create UTEXOWallet" hint="UTEXOWallet.create({ mnemonic, password, network, indexerUrl?, transportEndpoint? }) — auto-connects; URLs default per network when blank">
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
          <input value={transportEndpoint} onChange={(e) => setTransportEndpoint(e.target.value)} className={inputCls} placeholder="e.g. http://127.0.0.1:3001/rgb/json-rpc" />
        </Field>
        <Field label="LN Gateway proxyUrl (optional — blank = network default; enables the Lightning node)">
          <input value={proxyUrl} onChange={(e) => setProxyUrl(e.target.value)} className={inputCls} placeholder="e.g. ws://127.0.0.1:3001" />
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
      <Section title="2. goOnline()" hint="Retry the indexer connection — create() already auto-connects, so this is only needed if the wallet shows offline.">
        {utexoWarn}
        <Field label="Indexer URL">
          <input value={indexerUrl} onChange={(e) => setIndexerUrl(e.target.value)} className={inputCls} />
        </Field>
        <Btn variant="accent" onClick={handleGoOnline} disabled={!utexo}>Go Online</Btn>
        <OutputBox value={onlineOut} />
      </Section>

      {/* ── Wallet Info ───────────────────────────────────────────────────── */}
      <Section title="3. Wallet Info" hint="getAddress · getBtcBalance · listUnspents · listAssets · getAssetBalance">
        {utexoWarn}
        <div className="flex gap-2 flex-wrap mb-2">
          <Btn onClick={handleGetAddress} disabled={!utexo}>getAddress()</Btn>
          <Btn onClick={handleGetBalance} disabled={!utexo}>getBtcBalance()</Btn>
          <Btn variant="secondary" onClick={handleListUnspents} disabled={!utexo}>listUnspents()</Btn>
        </div>
        <OutputBox value={infoOut} />
      </Section>

      {/* ── Fund ──────────────────────────────────────────────────────────── */}
      <Section title="4. Fund Wallet" hint="utexo → UTEXO faucet node (rln-signet.utexo.com/faucet) · regtest → local gateway /dev/regtest/fund · testnet → thunderstack faucet">
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
      <Section title="5. Send BTC" hint="sendBtcBegin → signPsbt → sendBtcEnd (or sendBtc for one-shot)">
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
      <Section title="6. Create UTXOs" hint="Allocate colored UTXOs for RGB transfers. createUtxosBegin → signPsbt → createUtxosEnd">
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
      <Section title="7. Sync" hint="syncWallet() — sync BTC/UTXO state. refreshWallet() — refresh pending RGB transfers.">
        {utexoWarn}
        <div className="flex gap-2 flex-wrap">
          <Btn onClick={handleSync} disabled={!utexo}>syncWallet()</Btn>
          <Btn variant="secondary" onClick={handleRefresh} disabled={!utexo}>refreshWallet()</Btn>
        </div>
        <OutputBox value={syncOut} />
      </Section>

      {/* ── Issue NIA ─────────────────────────────────────────────────────── */}
      <Section title="8. Issue NIA Asset" hint="issueAssetNia() — Non-Inflatable Asset (fixed supply fungible token)">
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
      <Section title="9. Issue IFA Asset" hint="issueAssetIfa() — Inflatable Fungible Asset (supply can be increased)">
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
      <Section title="10. List Assets" hint="listAssets() · getAssetBalance(assetId)">
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
      <Section title="11. Receive RGB Assets" hint="onchainReceive({ assetId?, amount?, witness }) — RLN rgb_invoice parity: one call, witness (default) or blind via the flag. Share the invoice (rgb:…) with the sender, not the recipientId.">
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
      <Section title="12. Send RGB Assets" hint="onchainSendBegin → signPsbt → onchainSendEnd (or onchainSend() for one-shot) — the canonical RGB send, RN-parity names">
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
      <Section title="13. Transactions & Transfers" hint="listTransactions · listTransfers(assetId?) · failTransfers() — listOnchainTransfers() is an alias of listTransfers()">
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
      <Section title="14. Keys" hint="getXpub() — vanilla + colored account xpubs · getNetwork()">
        {utexoWarn}
        <div className="flex gap-4 items-end flex-wrap">
          <Btn onClick={handleGetXpub} disabled={!utexo} className="mb-4">getXpub() + getNetwork()</Btn>
        </div>
        <OutputBox value={pubKeysOut} />
      </Section>

      {/* ── Lightning ─────────────────────────────────────────────────────── */}
      <Section title="15. Lightning Protocol" hint="createLightningInvoice · payLightningInvoice — native Lightning via the embedded RLN node (requires channels; see the LSP page for zero-conf setup)">
        {utexoWarn}
        <p className="text-[#8b949e] text-xs mb-3">
          <span className="text-[#c9d1d9]">createLightningInvoice</span> — create a receive invoice
        </p>
        <div className="flex gap-4 mb-4 flex-wrap">
          <Field label="Asset ID">
            <input value={lnAssetId} onChange={(e) => setLnAssetId(e.target.value)} className={inputCls} placeholder="rgb:..." />
          </Field>
          <Field label="Amount">
            <input type="number" value={lnAmount} onChange={(e) => setLnAmount(e.target.value)} className={inputCls} placeholder="100" min="1" />
          </Field>
          <Btn onClick={handleCreateLightningInvoice} disabled={!utexo} className="mb-4">createLightningInvoice()</Btn>
        </div>
        <p className="text-[#8b949e] text-xs mb-3">
          <span className="text-[#c9d1d9]">payLightningInvoice</span> — atomic pay via the local RLN node (no begin/sign/end steps — the node signs internally)
        </p>
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
        <Btn variant="accent" onClick={handlePayLn} disabled={!utexo} className="mb-4">payLightningInvoice()</Btn>
        <div className="flex gap-4 mb-2 items-end flex-wrap">
          <Field label="Payment hash (for send status — returned as txid)">
            <input value={lnPaymentHash} onChange={(e) => setLnPaymentHash(e.target.value)} className={inputCls} placeholder="hex payment hash" />
          </Field>
        </div>
        <div className="flex gap-2 mb-4 flex-wrap">
          <Btn variant="secondary" onClick={handleGetLnSendStatus} disabled={!utexo}>getLightningSendRequest(paymentHash)</Btn>
          <Btn variant="secondary" onClick={handleGetLnReceiveStatus} disabled={!utexo}>getLightningReceiveRequest(invoice)</Btn>
        </div>
        <OutputBox value={lnOut} />
      </Section>

      {/* ── Validate Balance ──────────────────────────────────────────────── */}
      <Section title="16. Validate Balance" hint="Demo-side check via getAssetBalance() — the SDK has no validateBalance() method">
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
      <Section title="17. Decode / Sign / Verify" hint="decodeRGBInvoice · signMessage · verifyMessage">
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
    </div>
  );
}
