import React, { useState } from 'react';
import {
  generateKeys,
  RlnWalletManager,
  signPsbt,
} from '@utexo/rgb-sdk-web';
import type { IRlnNodeBinding } from '@utexo/rgb-sdk-web';
import { useStore } from '../store';
import type { WalletInstance, WalletConfig } from '../store';
import { Section } from '../components/Section';
import { Field, inputCls, selectCls, textareaCls } from '../components/Field';
import { Btn } from '../components/Btn';
import { OutputBox } from '../components/OutputBox';
import { StepFlow } from '../components/StepFlow';
import { useActiveWallet } from '../hooks/useActiveWallet';
import { json, proxyIndexerUrl, getIndexerUrl, getRlnIndexerUrl, getRlnTransportEndpoint, getRlnProxyUrl, downloadBytes } from '../lib/utils';
import { saveSessions, setUrlWallet } from '../lib/session';

let walletCounter = 0;
function nextId() {
  return 'rln_' + (++walletCounter) + '_' + Date.now();
}

const RLN_NETWORKS = ['utexo', 'signet', 'testnet', 'regtest', 'mainnet'] as const;

// ─── Page ─────────────────────────────────────────────────────────────────────

export function RlnWalletPage() {
  const addLog = useStore((s) => s.addLog);
  const addWallet = useStore((s) => s.addWallet);
  const removeWallet = useStore((s) => s.removeWallet);
  const updateWallet = useStore((s) => s.updateWallet);
  const wallets = useStore((s) => s.wallets);
  const activeWallet = useActiveWallet();
  const rlnManager =
    activeWallet?.type === 'rln' ? (activeWallet.instance as RlnWalletManager) : null;
  const walletId = activeWallet?.id ?? '';
  const mnemonic = activeWallet?.config.mnemonic ?? '';
  const network = activeWallet?.config.network ?? 'regtest';

  // ── Create wallet ─────────────────────────────────────────────────────────

  const [createNetwork, setCreateNetwork] = useState('regtest');
  const [createMnemonic, setCreateMnemonic] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createLabel, setCreateLabel] = useState('');
  const [createProxyUrl, setCreateProxyUrl] = useState(getRlnProxyUrl('regtest'));
  const [createTransport, setCreateTransport] = useState(getRlnTransportEndpoint('regtest'));
  const [createIndexerUrl, setCreateIndexerUrl] = useState(getRlnIndexerUrl('regtest'));
  const [creating, setCreating] = useState(false);
  const [createOut, setCreateOut] = useState('');

  async function handleGenMnemonic() {
    try {
      const keys = await generateKeys(createNetwork);
      setCreateMnemonic(keys.mnemonic);
      addLog('Mnemonic generated', 'ok');
    } catch (e) {
      addLog('Generate mnemonic failed: ' + e, 'err');
    }
  }

  async function handleCreate() {
    if (!createMnemonic.trim()) { setCreateOut('Enter or generate a mnemonic first'); return; }
    if (!createPassword.trim()) { setCreateOut('Password is required for RLN wallet'); return; }
    setCreating(true);
    setCreateOut('Creating RlnWalletManager...');
    try {
      const m = await RlnWalletManager.create({
        mnemonic: createMnemonic.trim(),
        password: createPassword.trim(),
        network: createNetwork,
        proxyUrl: createProxyUrl || undefined,
        transportEndpoint: createTransport || undefined,
      });

      const walletLabel = createLabel.trim() || `RlnWallet (${createNetwork})`;
      const config: WalletConfig = {
        network: createNetwork,
        indexerUrl: createIndexerUrl,
        transportEndpoint: createTransport,
        proxyUrl: createProxyUrl || undefined,
        masterFingerprint: '',
        xpubVan: '',
        xpubCol: '',
        mnemonic: createMnemonic.trim(),
        password: createPassword.trim(),
      };

      const hasLn = m.getLightningNode() !== null;
      const w: WalletInstance = {
        id: nextId(),
        label: walletLabel,
        type: 'rln',
        config,
        instance: m,
        online: false,
      };

      addWallet(w);
      const nextWallets = [...wallets, w];
      saveSessions(nextWallets, w.id);
      setUrlWallet(w.id);
      setCreateOut(
        `RlnWalletManager created\nLabel: ${walletLabel}\nNetwork: ${createNetwork}\nLightning node: ${hasLn ? 'yes' : 'no (transportEndpoint not set)'}`
      );
      addLog(`RlnWalletManager "${walletLabel}" created`, 'ok');
      setCreateMnemonic('');
      setCreatePassword('');
      setCreateLabel('');
    } catch (e) {
      setCreateOut('Error: ' + e);
      addLog('Create failed: ' + e, 'err');
    } finally {
      setCreating(false);
    }
  }

  function handleRemove() {
    if (!activeWallet) return;
    if (!window.confirm(`Remove wallet "${activeWallet.label}"?`)) return;
    removeWallet(activeWallet.id);
    const remaining = wallets.filter((w) => w.id !== activeWallet.id);
    saveSessions(remaining, remaining[remaining.length - 1]?.id ?? null);
    addLog(`Wallet "${activeWallet.label}" removed`, 'warn');
  }

  // ── Go Online ─────────────────────────────────────────────────────────────

  const [indexerUrl, setIndexerUrl] = useState('');
  const [skipConsistency, setSkipConsistency] = useState(false);
  const [onlineOut, setOnlineOut] = useState('');

  async function handleGoOnline() {
    if (!rlnManager) return;
    try {
      addLog('Going online...', 'info');
      // Pass undefined to use DEFAULT_INDEXER_URLS fallback when field is empty
      const url = indexerUrl.trim() || undefined;
      await rlnManager.goOnline(url ? proxyIndexerUrl(url) : undefined, skipConsistency);
      updateWallet(walletId, { online: true });
      setOnlineOut('Online' + (url ? '' : ' (using default indexer for network)'));
      addLog('Online', 'ok');
    } catch (e) {
      setOnlineOut('Error: ' + e);
      addLog('goOnline failed: ' + e, 'err');
    }
  }

  // ── Wallet Info ───────────────────────────────────────────────────────────

  const [infoOut, setInfoOut] = useState('');

  async function handleGetAddress() {
    try {
      const addr = await rlnManager!.getAddress();
      setInfoOut('Address: ' + addr);
    } catch (e) { setInfoOut('Error: ' + e); }
  }

  async function handleGetBtcBalance() {
    try {
      const bal = await rlnManager!.getBtcBalance();
      setInfoOut(json(bal));
    } catch (e) { setInfoOut('Error: ' + e); }
  }

  async function handleListUnspents() {
    try {
      const unspents = await rlnManager!.listUnspents();
      setInfoOut(json(unspents));
    } catch (e) { setInfoOut('Error: ' + e); }
  }

  async function handleRotateVanilla() {
    try {
      const addr = await rlnManager!.rotateVanillaAddress();
      setInfoOut('New vanilla address: ' + addr);
    } catch (e) { setInfoOut('Error: ' + e); }
  }

  async function handleRotateColored() {
    try {
      const addr = await rlnManager!.rotateColoredAddress();
      setInfoOut('New colored address: ' + addr);
    } catch (e) { setInfoOut('Error: ' + e); }
  }

  async function handleRefresh() {
    try {
      await rlnManager!.refreshWallet();
      setInfoOut('Wallet refreshed');
      addLog('refreshWallet() done', 'ok');
    } catch (e) { setInfoOut('Error: ' + e); }
  }

  async function handleSync() {
    try {
      await rlnManager!.syncWallet();
      setInfoOut('Wallet synced');
      addLog('syncWallet() done', 'ok');
    } catch (e) { setInfoOut('Error: ' + e); }
  }

  // ── Create UTXOs ──────────────────────────────────────────────────────────

  const [utxoNum, setUtxoNum] = useState('5');
  const [utxoSize, setUtxoSize] = useState('1000');
  const [utxoFeeRate, setUtxoFeeRate] = useState('1.5');
  const [utxoPendingPsbt, setUtxoPendingPsbt] = useState('');
  const [utxoSignedPsbt, setUtxoSignedPsbt] = useState('');
  const [utxosOut, setUtxosOut] = useState('');

  async function handleCreateUtxosBegin() {
    try {
      const psbt = await rlnManager!.createUtxosBegin({
        upTo: false,
        num: parseInt(utxoNum) || undefined,
        size: parseInt(utxoSize) || undefined,
        feeRate: parseFloat(utxoFeeRate) || undefined,
      });
      setUtxoPendingPsbt(psbt);
      setUtxosOut('PSBT: ' + psbt);
    } catch (e) { setUtxosOut('Error: ' + e); }
  }

  async function handleCreateUtxosSign() {
    try {
      const signed = await signPsbt(mnemonic, utxoPendingPsbt, network as 'regtest' | 'testnet' | 'signet' | 'mainnet');
      setUtxoSignedPsbt(signed);
      setUtxosOut('Signed PSBT: ' + signed);
    } catch (e) { setUtxosOut('Error signing: ' + e); }
  }

  async function handleCreateUtxosEnd() {
    try {
      const count = await rlnManager!.createUtxosEnd({ signedPsbt: utxoSignedPsbt });
      setUtxosOut('Created ' + count + ' UTXOs');
      addLog('createUtxos done: ' + count, 'ok');
    } catch (e) { setUtxosOut('Error: ' + e); }
  }

  async function handleCreateUtxosAuto() {
    try {
      const count = await rlnManager!.createUtxos({
        num: parseInt(utxoNum) || undefined,
        size: parseInt(utxoSize) || undefined,
        feeRate: parseFloat(utxoFeeRate) || undefined,
      });
      setUtxosOut('Created ' + count + ' UTXOs');
      addLog('createUtxos auto done: ' + count, 'ok');
    } catch (e) { setUtxosOut('Error: ' + e); }
  }

  // ── Assets ────────────────────────────────────────────────────────────────

  const [assetBalanceId, setAssetBalanceId] = useState('');
  const [issueTicker, setIssueTicker] = useState('TST');
  const [issueName, setIssueName] = useState('Test Token');
  const [issueAmounts, setIssueAmounts] = useState('1000');
  const [issuePrecision, setIssuePrecision] = useState('0');
  const [assetsOut, setAssetsOut] = useState('');

  async function handleListAssets() {
    try {
      const assets = await rlnManager!.listAssets();
      setAssetsOut(json(assets));
    } catch (e) { setAssetsOut('Error: ' + e); }
  }

  async function handleGetAssetBalance() {
    try {
      const bal = await rlnManager!.getAssetBalance(assetBalanceId);
      setAssetsOut(json(bal));
    } catch (e) { setAssetsOut('Error: ' + e); }
  }

  async function handleIssueNia() {
    try {
      addLog('Issuing NIA asset...', 'info');
      const amounts = issueAmounts.split(',').map((s) => Number(s.trim()));
      const asset = await rlnManager!.issueAssetNia({
        ticker: issueTicker,
        name: issueName,
        precision: parseInt(issuePrecision),
        amounts,
      });
      setAssetsOut(json(asset));
      addLog('NIA asset issued: ' + (asset as { assetId?: string }).assetId, 'ok');
    } catch (e) { setAssetsOut('Error: ' + e); }
  }

  // ── Receive ───────────────────────────────────────────────────────────────

  const [receiveAssetId, setReceiveAssetId] = useState('');
  const [receiveAmount, setReceiveAmount] = useState('');
  const [receiveExpiry, setReceiveExpiry] = useState('3600');
  const [decodeInvoiceStr, setDecodeInvoiceStr] = useState('');
  const [receiveOut, setReceiveOut] = useState('');

  function receiveParams() {
    return {
      assetId: receiveAssetId || undefined,
      amount: receiveAmount ? parseInt(receiveAmount) : undefined,
      durationSeconds: parseInt(receiveExpiry) || 3600,
      transportEndpoints: activeWallet?.config.transportEndpoint
        ? [activeWallet.config.transportEndpoint]
        : undefined,
      minConfirmations: 1,
    } as Parameters<RlnWalletManager['blindReceive']>[0];
  }

  async function handleBlindReceive() {
    try {
      const inv = await rlnManager!.blindReceive(receiveParams());
      setReceiveOut(json(inv));
      addLog('blindReceive done', 'ok');
    } catch (e) { setReceiveOut('Error: ' + e); }
  }

  async function handleWitnessReceive() {
    try {
      const inv = await rlnManager!.witnessReceive(receiveParams());
      setReceiveOut(json(inv));
      addLog('witnessReceive done', 'ok');
    } catch (e) { setReceiveOut('Error: ' + e); }
  }

  async function handleDecodeInvoice() {
    try {
      const data = await rlnManager!.decodeRGBInvoice({ invoice: decodeInvoiceStr });
      setReceiveOut(json(data));
    } catch (e) { setReceiveOut('Error: ' + e); }
  }

  // ── Send RGB ──────────────────────────────────────────────────────────────

  const [sendInvoice, setSendInvoice] = useState('');
  const [sendFeeRate, setSendFeeRate] = useState('1.5');
  const [sendDonation, setSendDonation] = useState(false);
  const [sendPendingPsbt, setSendPendingPsbt] = useState('');
  const [sendSignedPsbt, setSendSignedPsbt] = useState('');
  const [sendOut, setSendOut] = useState('');

  async function handleSendBegin() {
    try {
      const psbt = await rlnManager!.sendBegin({
        invoice: sendInvoice,
        feeRate: parseFloat(sendFeeRate) || 1,
        donation: sendDonation,
        minConfirmations: 1,
      });
      setSendPendingPsbt(psbt);
      setSendOut('PSBT: ' + psbt);
    } catch (e) { setSendOut('Error: ' + e); }
  }

  async function handleSendSign() {
    try {
      const signed = await signPsbt(mnemonic, sendPendingPsbt, network as 'regtest' | 'testnet' | 'signet' | 'mainnet');
      setSendSignedPsbt(signed);
      setSendOut('Signed PSBT: ' + signed);
    } catch (e) { setSendOut('Error signing: ' + e); }
  }

  async function handleSendEnd() {
    try {
      const result = await rlnManager!.sendEnd({ signedPsbt: sendSignedPsbt });
      setSendOut(json(result));
      addLog('sendEnd done', 'ok');
    } catch (e) { setSendOut('Error: ' + e); }
  }

  async function handleSendAuto() {
    try {
      const result = await rlnManager!.sendWithSigner(
        { invoice: sendInvoice, feeRate: parseFloat(sendFeeRate) || 1, donation: sendDonation, minConfirmations: 1 },
        (psbt) => signPsbt(mnemonic, psbt, network as 'regtest' | 'testnet' | 'signet' | 'mainnet')
      );
      setSendOut(json(result));
      addLog('send auto done', 'ok');
    } catch (e) { setSendOut('Error: ' + e); }
  }

  // ── sendRgbFromGroups ─────────────────────────────────────────────────────

  const [groupsJson, setGroupsJson] = useState('{}');
  const [groupsOut, setGroupsOut] = useState('');

  async function handleSendRgbFromGroups() {
    try {
      const params = JSON.parse(groupsJson);
      const result = await rlnManager!.sendRgbFromGroups(params);
      setGroupsOut(json(result));
      addLog('sendRgbFromGroups done', 'ok');
    } catch (e) { setGroupsOut('Error: ' + e); }
  }

  // ── Send BTC ──────────────────────────────────────────────────────────────

  const [btcAddress, setBtcAddress] = useState('');
  const [btcAmount, setBtcAmount] = useState('');
  const [btcFeeRate, setBtcFeeRate] = useState('1.5');
  const [btcPendingPsbt, setBtcPendingPsbt] = useState('');
  const [btcSignedPsbt, setBtcSignedPsbt] = useState('');
  const [btcOut, setBtcOut] = useState('');

  async function handleBtcBegin() {
    try {
      const psbt = await rlnManager!.sendBtcBegin({
        address: btcAddress,
        amount: parseInt(btcAmount),
        feeRate: parseFloat(btcFeeRate) || 1,
      });
      setBtcPendingPsbt(psbt);
      setBtcOut('PSBT: ' + psbt);
    } catch (e) { setBtcOut('Error: ' + e); }
  }

  async function handleBtcSign() {
    try {
      const signed = await signPsbt(mnemonic, btcPendingPsbt, network as 'regtest' | 'testnet' | 'signet' | 'mainnet');
      setBtcSignedPsbt(signed);
      setBtcOut('Signed PSBT: ' + signed);
    } catch (e) { setBtcOut('Error signing: ' + e); }
  }

  async function handleBtcEnd() {
    try {
      const txid = await rlnManager!.sendBtcEnd({ signedPsbt: btcSignedPsbt });
      setBtcOut('txid: ' + txid);
      addLog('sendBtcEnd txid: ' + txid, 'ok');
    } catch (e) { setBtcOut('Error: ' + e); }
  }

  async function handleBtcAuto() {
    try {
      const txid = await rlnManager!.sendBtcWithSigner(
        { address: btcAddress, amount: parseInt(btcAmount), feeRate: parseFloat(btcFeeRate) || 1 },
        (psbt) => signPsbt(mnemonic, psbt, network as 'regtest' | 'testnet' | 'signet' | 'mainnet')
      );
      setBtcOut('txid: ' + txid);
      addLog('sendBtc auto txid: ' + txid, 'ok');
    } catch (e) { setBtcOut('Error: ' + e); }
  }

  // ── Transfers & Transactions ──────────────────────────────────────────────

  const [txTransferAssetId, setTxTransferAssetId] = useState('');
  const [failTransferIdx, setFailTransferIdx] = useState('');
  const [txOut, setTxOut] = useState('');

  async function handleListTransactions() {
    try {
      const txs = await rlnManager!.listTransactions();
      setTxOut(json(txs));
    } catch (e) { setTxOut('Error: ' + e); }
  }

  async function handleListTransfers() {
    try {
      const transfers = await rlnManager!.listTransfers(txTransferAssetId || undefined);
      setTxOut(json(transfers));
    } catch (e) { setTxOut('Error: ' + e); }
  }

  async function handleFailTransfers() {
    try {
      const batchTransferIdx = failTransferIdx.trim() ? parseInt(failTransferIdx) : undefined;
      const result = await rlnManager!.failTransfers({ batchTransferIdx, noAssetOnly: false });
      setTxOut('failTransfers: ' + result);
      addLog('failTransfers done', 'ok');
    } catch (e) { setTxOut('Error: ' + e); }
  }

  // ── Fee ───────────────────────────────────────────────────────────────────

  const [feeBlocks, setFeeBlocks] = useState('6');
  const [feeOut, setFeeOut] = useState('');

  async function handleEstimateFeeRate() {
    try {
      const est = await rlnManager!.estimateFeeRate(parseInt(feeBlocks) || 6);
      setFeeOut(json(est));
    } catch (e) { setFeeOut('Error: ' + e); }
  }

  // ── Backup ────────────────────────────────────────────────────────────────

  const [backupPassword, setBackupPassword] = useState('');
  const [backupOut, setBackupOut] = useState('');

  async function handleCreateBackup() {
    try {
      addLog('Creating backup...', 'info');
      await rlnManager!.createBackup({ backupPath: '', password: backupPassword });
      const bytes = rlnManager!.getLastBackupBytes();
      if (bytes) {
        downloadBytes(bytes, 'rln_wallet_backup.bak');
        setBackupOut('Backup created and downloaded (' + bytes.length + ' bytes)');
        addLog('Backup downloaded', 'ok');
      } else {
        setBackupOut('createBackup produced no bytes');
      }
    } catch (e) { setBackupOut('Error: ' + e); }
  }

  // ── Lightning ─────────────────────────────────────────────────────────────

  const node: IRlnNodeBinding | null = rlnManager?.getLightningNode() ?? null;

  const [peerAddr, setPeerAddr] = useState('');
  const [peerPubkey, setPeerPubkey] = useState('');
  const [disconnectPubkey, setDisconnectPubkey] = useState('');
  const [peersOut, setPeersOut] = useState('');

  async function handleConnectPeer() {
    try {
      await node!.connectPeer(peerAddr, peerPubkey);
      setPeersOut('Connected to ' + peerPubkey);
      addLog('connectPeer done', 'ok');
    } catch (e) { setPeersOut('Error: ' + e); }
  }

  async function handleDisconnectPeer() {
    try {
      await node!.disconnectPeer(disconnectPubkey);
      setPeersOut('Disconnected from ' + disconnectPubkey);
      addLog('disconnectPeer done', 'ok');
    } catch (e) { setPeersOut('Error: ' + e); }
  }

  async function handleListPeers() {
    try {
      const peers = await node!.listPeers();
      setPeersOut(json(peers));
    } catch (e) { setPeersOut('Error: ' + e); }
  }

  const [chanPeerPubkey, setChanPeerPubkey] = useState('');
  const [chanCapacity, setChanCapacity] = useState('100000');
  const [chanPublic, setChanPublic] = useState(true);
  const [chanAssetId, setChanAssetId] = useState('');
  const [closeChannelId, setCloseChannelId] = useState('');
  const [closeForce, setCloseForce] = useState(false);
  const [channelsOut, setChannelsOut] = useState('');

  async function handleOpenChannel() {
    try {
      const tempChannelId = await node!.openChannel({
        peerPubkey: chanPeerPubkey,
        capacitySat: BigInt(chanCapacity),
        isPublic: chanPublic,
        assetId: chanAssetId || undefined,
      });
      setChannelsOut('Channel opened. tempChannelId: ' + tempChannelId);
      addLog('openChannel done', 'ok');
    } catch (e) { setChannelsOut('Error: ' + e); }
  }

  async function handleCloseChannel() {
    try {
      node!.closeChannel(closeChannelId, undefined, closeForce);
      setChannelsOut('Close requested for channel: ' + closeChannelId);
    } catch (e) { setChannelsOut('Error: ' + e); }
  }

  async function handleListChannels() {
    try {
      const channels = await node!.listChannels();
      setChannelsOut(json(channels));
    } catch (e) { setChannelsOut('Error: ' + e); }
  }

  const [lnInvoiceAmtMsat, setLnInvoiceAmtMsat] = useState('100000');
  const [lnInvoiceExpiry, setLnInvoiceExpiry] = useState('3600');
  const [lnInvoiceAssetId, setLnInvoiceAssetId] = useState('');
  const [hodlHash, setHodlHash] = useState('');
  const [hodlPaymentHash, setHodlPaymentHash] = useState('');
  const [hodlPreimage, setHodlPreimage] = useState('');
  const [invoiceOut, setInvoiceOut] = useState('');

  async function handleCreateLnInvoice() {
    try {
      const inv = await node!.createLnInvoice({
        amtMsat: BigInt(lnInvoiceAmtMsat),
        expirySec: parseInt(lnInvoiceExpiry) || 3600,
        assetId: lnInvoiceAssetId || undefined,
      });
      setInvoiceOut(json(inv));
      addLog('createLnInvoice done', 'ok');
    } catch (e) { setInvoiceOut('Error: ' + e); }
  }

  async function handleCreateHodlInvoice() {
    try {
      const inv = await node!.createHodlLnInvoice({
        paymentHash: hodlHash,
        amtMsat: BigInt(lnInvoiceAmtMsat),
        expirySec: parseInt(lnInvoiceExpiry) || 3600,
        assetId: lnInvoiceAssetId || undefined,
      });
      setInvoiceOut(json(inv));
      addLog('createHodlLnInvoice done', 'ok');
    } catch (e) { setInvoiceOut('Error: ' + e); }
  }

  async function handleClaimHodl() {
    try {
      const result = await node!.claimHodlInvoice(hodlPaymentHash, hodlPreimage);
      setInvoiceOut(json(result));
      addLog('claimHodlInvoice done', 'ok');
    } catch (e) { setInvoiceOut('Error: ' + e); }
  }

  async function handleCancelHodl() {
    try {
      const result = await node!.cancelHodlInvoice(hodlPaymentHash);
      setInvoiceOut(json(result));
      addLog('cancelHodlInvoice done', 'ok');
    } catch (e) { setInvoiceOut('Error: ' + e); }
  }

  const [payInvoice, setPayInvoice] = useState('');
  const [payAmtMsat, setPayAmtMsat] = useState('');
  const [keysendPubkey, setKeysendPubkey] = useState('');
  const [keysendAmtMsat, setKeysendAmtMsat] = useState('');
  const [getPaymentHash, setGetPaymentHash] = useState('');
  const [paymentsOut, setPaymentsOut] = useState('');

  async function handleSendPayment() {
    try {
      const result = await node!.sendPayment({
        invoice: payInvoice,
        amtMsat: payAmtMsat ? BigInt(payAmtMsat) : undefined,
      });
      setPaymentsOut(json(result));
      addLog('sendPayment done', 'ok');
    } catch (e) { setPaymentsOut('Error: ' + e); }
  }

  async function handleKeysend() {
    try {
      const result = await node!.keysend({
        destPubkey: keysendPubkey,
        amtMsat: BigInt(keysendAmtMsat),
      });
      setPaymentsOut(json(result));
      addLog('keysend done', 'ok');
    } catch (e) { setPaymentsOut('Error: ' + e); }
  }

  async function handleListPayments() {
    try {
      const payments = await node!.listPayments();
      setPaymentsOut(json(payments));
    } catch (e) { setPaymentsOut('Error: ' + e); }
  }

  async function handleGetPayment() {
    try {
      const payment = await node!.getPayment(getPaymentHash);
      setPaymentsOut(json(payment));
    } catch (e) { setPaymentsOut('Error: ' + e); }
  }

  const [nodeInfoOut, setNodeInfoOut] = useState('');
  const [signLnMsg, setSignLnMsg] = useState('');
  const [decodeLnInvoice, setDecodeLnInvoice] = useState('');

  async function handleNodeInfo() {
    try {
      const info = await node!.nodeInfo();
      setNodeInfoOut(json(info));
    } catch (e) { setNodeInfoOut('Error: ' + e); }
  }

  async function handleSignLnMessage() {
    try {
      const sig = await node!.signMessage(signLnMsg);
      setNodeInfoOut('Signature: ' + sig);
    } catch (e) { setNodeInfoOut('Error: ' + e); }
  }

  async function handleDecodeLnInvoice() {
    try {
      const data = await node!.decodeLnInvoice(decodeLnInvoice);
      setNodeInfoOut(json(data));
    } catch (e) { setNodeInfoOut('Error: ' + e); }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      <h1 className="text-[#58a6ff] text-2xl font-bold mb-1">RLN Wallet</h1>
      <p className="text-[#8b949e] text-sm mb-6">
        RlnWalletManager — RGB + Lightning via <code className="text-[#c9d1d9]">rln-wasm-sdk</code>
      </p>

      {/* ── Create ────────────────────────────────────────────────────── */}
      <Section title="Create RlnWalletManager">
        <div className="flex gap-4 mb-4 flex-wrap">
          <Field label="Network">
            <select
              value={createNetwork}
              onChange={(e) => {
                setCreateNetwork(e.target.value);
                setCreateProxyUrl(getRlnProxyUrl(e.target.value));
                setCreateTransport(getRlnTransportEndpoint(e.target.value));
                setCreateIndexerUrl(getRlnIndexerUrl(e.target.value));
              }}
              className={selectCls}
            >
              {RLN_NETWORKS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
          <Field label="Label (optional)">
            <input value={createLabel} onChange={(e) => setCreateLabel(e.target.value)} className={inputCls} placeholder='e.g. "Alice"' />
          </Field>
        </div>
        <Field label="Mnemonic">
          <textarea value={createMnemonic} onChange={(e) => setCreateMnemonic(e.target.value)} className={textareaCls} rows={2} placeholder="Enter 12/24-word mnemonic, or click Generate" />
        </Field>
        <Field label="Password (required — encrypts wallet DB)">
          <input type="password" value={createPassword} onChange={(e) => setCreatePassword(e.target.value)} className={inputCls} placeholder="Enter SDK password" />
        </Field>
        <Field label="Node proxy URL (WebSocket)" hint="WebSocket URL for the Lightning node. Leave blank to disable Lightning.">
          <input value={createProxyUrl} onChange={(e) => setCreateProxyUrl(e.target.value)} className={inputCls} placeholder="ws://127.0.0.1:3001/rgb/json-rpc" />
        </Field>
        <Field label="Transport endpoint (HTTP)" hint="RGB proxy HTTP endpoint for consignment delivery.">
          <input value={createTransport} onChange={(e) => setCreateTransport(e.target.value)} className={inputCls} placeholder="http://127.0.0.1:3001/rgb/json-rpc" />
        </Field>
        <Field label="Indexer URL (Esplora, for goOnline)">
          <input value={createIndexerUrl} onChange={(e) => setCreateIndexerUrl(e.target.value)} className={inputCls} placeholder="http://127.0.0.1:3002" />
        </Field>
        <div className="flex gap-2 mb-4 flex-wrap">
          <Btn variant="secondary" onClick={handleGenMnemonic} disabled={creating}>Generate Mnemonic</Btn>
          <Btn onClick={handleCreate} disabled={creating}>
            {creating ? 'Creating...' : 'RlnWalletManager.create()'}
          </Btn>
        </div>
        <OutputBox value={createOut} />
      </Section>

      {/* ── Active wallet info ────────────────────────────────────────── */}
      {activeWallet?.type === 'rln' && (
        <Section title={'Active: ' + activeWallet.label}>
          <div className="bg-[#0d1117] border border-[#30363d] rounded p-4 font-mono text-xs leading-relaxed space-y-1 mb-4">
            <div><span className="text-[#8b949e]">type:</span> <span className="text-[#58a6ff]">RlnWalletManager</span></div>
            <div><span className="text-[#8b949e]">network:</span> <span className="text-[#c9d1d9]">{activeWallet.config.network}</span></div>
            <div><span className="text-[#8b949e]">online:</span> <span className={activeWallet.online ? 'text-[#3fb950]' : 'text-[#484f58]'}>{activeWallet.online ? 'yes' : 'no'}</span></div>
            <div><span className="text-[#8b949e]">lightningNode:</span> <span className={node ? 'text-[#3fb950]' : 'text-[#484f58]'}>{node ? 'yes' : 'no (proxyUrl not set)'}</span></div>
            {node && (
              <div><span className="text-[#8b949e]">nodePubkey:</span> <span className="text-[#c9d1d9] break-all">{node.nodePubkey() || '—'}</span></div>
            )}
            {activeWallet.config.proxyUrl && (
              <div><span className="text-[#8b949e]">proxyUrl:</span> <span className="text-[#c9d1d9]">{activeWallet.config.proxyUrl}</span></div>
            )}
            {activeWallet.config.transportEndpoint && (
              <div><span className="text-[#8b949e]">transportEndpoint:</span> <span className="text-[#c9d1d9]">{activeWallet.config.transportEndpoint}</span></div>
            )}
          </div>
          <Btn variant="danger" onClick={handleRemove}>Remove Wallet</Btn>
        </Section>
      )}

      {/* ── Operations (only when an RLN wallet is active) ─────────────── */}
      {rlnManager && (
        <>
          {/* ── Go Online ─────────────────────────────────────────────── */}
          <Section title="1. Go Online" hint="goOnline(indexerUrl?) — leave blank to use DEFAULT_INDEXER_URLS for the wallet's network">
            <Field label="Indexer URL (leave blank for network default)">
              <input value={indexerUrl} onChange={(e) => setIndexerUrl(e.target.value)} className={inputCls} placeholder="leave blank for DEFAULT_INDEXER_URLS[network]" />
            </Field>
            <label className="flex items-center gap-2 mb-4 cursor-pointer select-none text-sm text-[#c9d1d9]">
              <input type="checkbox" checked={skipConsistency} onChange={(e) => setSkipConsistency(e.target.checked)} className="w-4 h-4 accent-[#58a6ff]" />
              skipConsistencyCheck
            </label>
            <Btn onClick={handleGoOnline}>goOnline()</Btn>
            <OutputBox value={onlineOut} />
          </Section>

          {/* ── Wallet Info ───────────────────────────────────────────── */}
          <Section title="2. Wallet Info" hint="Address, balance, UTXOs, rotate addresses, sync">
            <div className="flex gap-2 flex-wrap mb-4">
              <Btn variant="secondary" onClick={handleGetAddress}>getAddress()</Btn>
              <Btn variant="secondary" onClick={handleGetBtcBalance}>getBtcBalance()</Btn>
              <Btn variant="secondary" onClick={handleListUnspents}>listUnspents()</Btn>
              <Btn variant="secondary" onClick={handleRotateVanilla}>rotateVanillaAddress()</Btn>
              <Btn variant="secondary" onClick={handleRotateColored}>rotateColoredAddress()</Btn>
              <Btn variant="secondary" onClick={handleRefresh}>refreshWallet()</Btn>
              <Btn variant="secondary" onClick={handleSync}>syncWallet()</Btn>
            </div>
            <OutputBox value={infoOut} />
          </Section>

          {/* ── Create UTXOs ──────────────────────────────────────────── */}
          <Section title="3. Create UTXOs" hint="createUtxosBegin → signPsbt → createUtxosEnd (or auto)">
            <div className="flex gap-4 mb-4 flex-wrap">
              <Field label="Num UTXOs">
                <input value={utxoNum} onChange={(e) => setUtxoNum(e.target.value)} className={inputCls} type="number" placeholder="5" />
              </Field>
              <Field label="Size (sats)">
                <input value={utxoSize} onChange={(e) => setUtxoSize(e.target.value)} className={inputCls} type="number" placeholder="1000" />
              </Field>
              <Field label="Fee rate (sat/vB)">
                <input value={utxoFeeRate} onChange={(e) => setUtxoFeeRate(e.target.value)} className={inputCls} type="number" placeholder="1.5" />
              </Field>
            </div>
            <StepFlow
              steps={[
                { label: '1. createUtxosBegin()', onClick: handleCreateUtxosBegin },
                { label: '2. signPsbt()', variant: 'warning', onClick: handleCreateUtxosSign },
                { label: '3. createUtxosEnd()', variant: 'accent', onClick: handleCreateUtxosEnd },
              ]}
              auto={{ label: 'Auto createUtxos()', onClick: handleCreateUtxosAuto }}
            />
            <OutputBox value={utxosOut} />
          </Section>

          {/* ── Assets ────────────────────────────────────────────────── */}
          <Section title="4. Assets" hint="listAssets, getAssetBalance, issueAssetNia (requires Lightning node)">
            <div className="flex gap-2 flex-wrap mb-4">
              <Btn variant="secondary" onClick={handleListAssets}>listAssets()</Btn>
            </div>
            <div className="flex gap-4 mb-4 flex-wrap">
              <Field label="Asset ID">
                <input value={assetBalanceId} onChange={(e) => setAssetBalanceId(e.target.value)} className={inputCls} placeholder="rgb1..." />
              </Field>
              <div className="flex items-end">
                <Btn variant="secondary" onClick={handleGetAssetBalance}>getAssetBalance(assetId)</Btn>
              </div>
            </div>
            <p className="text-xs text-[#8b949e] mb-3">Issue NIA (requires Lightning node with transportEndpoint)</p>
            <div className="flex gap-4 mb-4 flex-wrap">
              <Field label="Ticker">
                <input value={issueTicker} onChange={(e) => setIssueTicker(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Name">
                <input value={issueName} onChange={(e) => setIssueName(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Precision">
                <input value={issuePrecision} onChange={(e) => setIssuePrecision(e.target.value)} className={inputCls} type="number" />
              </Field>
              <Field label="Amounts (comma-separated)">
                <input value={issueAmounts} onChange={(e) => setIssueAmounts(e.target.value)} className={inputCls} placeholder="1000,500" />
              </Field>
            </div>
            <Btn onClick={handleIssueNia} disabled={!node}>
              {node ? 'issueAssetNia()' : 'issueAssetNia() (no LN node)'}
            </Btn>
            <OutputBox value={assetsOut} />
          </Section>

          {/* ── Receive ───────────────────────────────────────────────── */}
          <Section title="5. Receive" hint="blindReceive / witnessReceive / decodeRGBInvoice">
            <div className="flex gap-4 mb-4 flex-wrap">
              <Field label="Asset ID (optional)">
                <input value={receiveAssetId} onChange={(e) => setReceiveAssetId(e.target.value)} className={inputCls} placeholder="rgb1..." />
              </Field>
              <Field label="Amount (optional)">
                <input value={receiveAmount} onChange={(e) => setReceiveAmount(e.target.value)} className={inputCls} type="number" />
              </Field>
              <Field label="Expiry (seconds)">
                <input value={receiveExpiry} onChange={(e) => setReceiveExpiry(e.target.value)} className={inputCls} type="number" />
              </Field>
            </div>
            <div className="flex gap-2 flex-wrap mb-4">
              <Btn onClick={handleBlindReceive}>blindReceive()</Btn>
              <Btn variant="secondary" onClick={handleWitnessReceive}>witnessReceive()</Btn>
            </div>
            <Field label="Decode RGB Invoice">
              <input value={decodeInvoiceStr} onChange={(e) => setDecodeInvoiceStr(e.target.value)} className={inputCls} placeholder="rgb:..." />
            </Field>
            <Btn variant="secondary" onClick={handleDecodeInvoice}>decodeRGBInvoice()</Btn>
            <OutputBox value={receiveOut} />
          </Section>

          {/* ── Send RGB ──────────────────────────────────────────────── */}
          <Section title="6. Send RGB" hint="sendBegin → signPsbt → sendEnd (or sendWithSigner for one-shot)">
            <div className="flex gap-4 mb-4 flex-wrap">
              <Field label="RGB Invoice">
                <input value={sendInvoice} onChange={(e) => setSendInvoice(e.target.value)} className={inputCls} placeholder="rgb:..." />
              </Field>
              <Field label="Fee rate (sat/vB)">
                <input value={sendFeeRate} onChange={(e) => setSendFeeRate(e.target.value)} className={inputCls} type="number" />
              </Field>
            </div>
            <label className="flex items-center gap-2 mb-4 cursor-pointer select-none text-sm text-[#c9d1d9]">
              <input type="checkbox" checked={sendDonation} onChange={(e) => setSendDonation(e.target.checked)} className="w-4 h-4 accent-[#58a6ff]" />
              donation
            </label>
            <StepFlow
              steps={[
                { label: '1. sendBegin()', onClick: handleSendBegin },
                { label: '2. signPsbt()', variant: 'warning', onClick: handleSendSign },
                { label: '3. sendEnd()', variant: 'accent', onClick: handleSendEnd },
              ]}
              auto={{ label: 'Auto sendWithSigner()', onClick: handleSendAuto }}
            />
            <OutputBox value={sendOut} />
          </Section>

          {/* ── sendRgbFromGroups ─────────────────────────────────────── */}
          <Section title="7. sendRgbFromGroups" hint="Group-based RGB routing via Lightning channels">
            <Field label="Request JSON">
              <textarea value={groupsJson} onChange={(e) => setGroupsJson(e.target.value)} className={textareaCls} rows={4} />
            </Field>
            <Btn onClick={handleSendRgbFromGroups}>sendRgbFromGroups()</Btn>
            <OutputBox value={groupsOut} />
          </Section>

          {/* ── Send BTC ──────────────────────────────────────────────── */}
          <Section title="8. Send BTC" hint="sendBtcBegin → signPsbt → sendBtcEnd (or sendBtcWithSigner for one-shot)">
            <div className="flex gap-4 mb-4 flex-wrap">
              <Field label="Address">
                <input value={btcAddress} onChange={(e) => setBtcAddress(e.target.value)} className={inputCls} placeholder="bc1q..." />
              </Field>
              <Field label="Amount (sats)">
                <input value={btcAmount} onChange={(e) => setBtcAmount(e.target.value)} className={inputCls} type="number" />
              </Field>
              <Field label="Fee rate (sat/vB)">
                <input value={btcFeeRate} onChange={(e) => setBtcFeeRate(e.target.value)} className={inputCls} type="number" />
              </Field>
            </div>
            <StepFlow
              steps={[
                { label: '1. sendBtcBegin()', onClick: handleBtcBegin },
                { label: '2. signPsbt()', variant: 'warning', onClick: handleBtcSign },
                { label: '3. sendBtcEnd()', variant: 'accent', onClick: handleBtcEnd },
              ]}
              auto={{ label: 'Auto sendBtcWithSigner()', onClick: handleBtcAuto }}
            />
            <OutputBox value={btcOut} />
          </Section>

          {/* ── Transfers & Transactions ──────────────────────────────── */}
          <Section title="9. Transfers & Transactions" hint="listTransactions, listTransfers, failTransfers">
            <Field label="Asset ID (for listTransfers, optional)">
              <input value={txTransferAssetId} onChange={(e) => setTxTransferAssetId(e.target.value)} className={inputCls} placeholder="rgb1... (leave blank for all)" />
            </Field>
            <div className="flex gap-2 flex-wrap mb-4">
              <Btn variant="secondary" onClick={handleListTransactions}>listTransactions()</Btn>
              <Btn variant="secondary" onClick={handleListTransfers}>listTransfers()</Btn>
            </div>
            <Field label="Batch transfer index (for failTransfers, optional)">
              <input value={failTransferIdx} onChange={(e) => setFailTransferIdx(e.target.value)} className={inputCls} type="number" placeholder="leave blank for all" />
            </Field>
            <Btn variant="danger" onClick={handleFailTransfers}>failTransfers()</Btn>
            <OutputBox value={txOut} />
          </Section>

          {/* ── Fee Estimation ────────────────────────────────────────── */}
          <Section title="10. Fee Estimation" hint="estimateFeeRate(blocks)">
            <Field label="Target blocks">
              <input value={feeBlocks} onChange={(e) => setFeeBlocks(e.target.value)} className={inputCls} type="number" />
            </Field>
            <Btn variant="secondary" onClick={handleEstimateFeeRate}>estimateFeeRate()</Btn>
            <OutputBox value={feeOut} />
          </Section>

          {/* ── Backup ────────────────────────────────────────────────── */}
          <Section title="11. Backup" hint="createBackup — produces a binary backup file">
            <Field label="Backup password">
              <input type="password" value={backupPassword} onChange={(e) => setBackupPassword(e.target.value)} className={inputCls} />
            </Field>
            <Btn onClick={handleCreateBackup}>createBackup() + download</Btn>
            <OutputBox value={backupOut} />
          </Section>

          {/* ── Lightning ────────────────────────────────────────────── */}
          {node ? (
            <>
              {/* ── Node Info ─────────────────────────────────────────── */}
              <Section title="12. Lightning — Node Info" hint="nodeInfo, signMessage, decodeLnInvoice">
                <div className="flex gap-2 flex-wrap mb-4">
                  <Btn variant="secondary" onClick={() => setNodeInfoOut(node!.nodePubkey())}>nodePubkey()</Btn>
                  <Btn variant="secondary" onClick={handleNodeInfo}>nodeInfo()</Btn>
                </div>
                <Field label="Sign Message">
                  <input value={signLnMsg} onChange={(e) => setSignLnMsg(e.target.value)} className={inputCls} placeholder="message to sign" />
                </Field>
                <Btn variant="secondary" onClick={handleSignLnMessage} className="mb-4">signMessage()</Btn>
                <Field label="Decode LN Invoice">
                  <input value={decodeLnInvoice} onChange={(e) => setDecodeLnInvoice(e.target.value)} className={inputCls} placeholder="lnbc..." />
                </Field>
                <Btn variant="secondary" onClick={handleDecodeLnInvoice}>decodeLnInvoice()</Btn>
                <OutputBox value={nodeInfoOut} />
              </Section>

              {/* ── Peers ─────────────────────────────────────────────── */}
              <Section title="13. Lightning — Peers" hint="connectPeer, disconnectPeer, listPeers">
                <div className="flex gap-4 mb-4 flex-wrap">
                  <Field label="Peer address (host:port)">
                    <input value={peerAddr} onChange={(e) => setPeerAddr(e.target.value)} className={inputCls} placeholder="127.0.0.1:9735" />
                  </Field>
                  <Field label="Peer pubkey">
                    <input value={peerPubkey} onChange={(e) => setPeerPubkey(e.target.value)} className={inputCls} placeholder="02..." />
                  </Field>
                </div>
                <div className="flex gap-2 flex-wrap mb-4">
                  <Btn onClick={handleConnectPeer}>connectPeer()</Btn>
                  <Btn variant="secondary" onClick={handleListPeers}>listPeers()</Btn>
                </div>
                <Field label="Disconnect pubkey">
                  <input value={disconnectPubkey} onChange={(e) => setDisconnectPubkey(e.target.value)} className={inputCls} placeholder="02..." />
                </Field>
                <Btn variant="warning" onClick={handleDisconnectPeer}>disconnectPeer()</Btn>
                <OutputBox value={peersOut} />
              </Section>

              {/* ── Channels ──────────────────────────────────────────── */}
              <Section title="14. Lightning — Channels" hint="openChannel, closeChannel, listChannels">
                <div className="flex gap-4 mb-4 flex-wrap">
                  <Field label="Peer pubkey">
                    <input value={chanPeerPubkey} onChange={(e) => setChanPeerPubkey(e.target.value)} className={inputCls} placeholder="02..." />
                  </Field>
                  <Field label="Capacity (sats)">
                    <input value={chanCapacity} onChange={(e) => setChanCapacity(e.target.value)} className={inputCls} type="number" />
                  </Field>
                  <Field label="Asset ID (optional — RGB channel)">
                    <input value={chanAssetId} onChange={(e) => setChanAssetId(e.target.value)} className={inputCls} placeholder="rgb1..." />
                  </Field>
                </div>
                <label className="flex items-center gap-2 mb-4 cursor-pointer select-none text-sm text-[#c9d1d9]">
                  <input type="checkbox" checked={chanPublic} onChange={(e) => setChanPublic(e.target.checked)} className="w-4 h-4 accent-[#58a6ff]" />
                  Public channel
                </label>
                <div className="flex gap-2 flex-wrap mb-4">
                  <Btn onClick={handleOpenChannel}>openChannel()</Btn>
                  <Btn variant="secondary" onClick={handleListChannels}>listChannels()</Btn>
                </div>
                <div className="flex gap-4 mb-4 flex-wrap">
                  <Field label="Channel ID to close">
                    <input value={closeChannelId} onChange={(e) => setCloseChannelId(e.target.value)} className={inputCls} placeholder="channel id" />
                  </Field>
                </div>
                <label className="flex items-center gap-2 mb-4 cursor-pointer select-none text-sm text-[#c9d1d9]">
                  <input type="checkbox" checked={closeForce} onChange={(e) => setCloseForce(e.target.checked)} className="w-4 h-4 accent-[#58a6ff]" />
                  Force close
                </label>
                <Btn variant="danger" onClick={handleCloseChannel}>closeChannel()</Btn>
                <OutputBox value={channelsOut} />
              </Section>

              {/* ── Invoices ──────────────────────────────────────────── */}
              <Section title="15. Lightning — Invoices" hint="createLnInvoice, createHodlLnInvoice, claim/cancel HODL">
                <div className="flex gap-4 mb-4 flex-wrap">
                  <Field label="Amount (msat)">
                    <input value={lnInvoiceAmtMsat} onChange={(e) => setLnInvoiceAmtMsat(e.target.value)} className={inputCls} type="number" />
                  </Field>
                  <Field label="Expiry (seconds)">
                    <input value={lnInvoiceExpiry} onChange={(e) => setLnInvoiceExpiry(e.target.value)} className={inputCls} type="number" />
                  </Field>
                  <Field label="Asset ID (optional — RGB invoice)">
                    <input value={lnInvoiceAssetId} onChange={(e) => setLnInvoiceAssetId(e.target.value)} className={inputCls} placeholder="rgb1..." />
                  </Field>
                </div>
                <div className="flex gap-2 flex-wrap mb-4">
                  <Btn onClick={handleCreateLnInvoice}>createLnInvoice()</Btn>
                </div>
                <Field label="HODL invoice paymentHash">
                  <input value={hodlHash} onChange={(e) => setHodlHash(e.target.value)} className={inputCls} placeholder="32-byte hex" />
                </Field>
                <Btn variant="secondary" onClick={handleCreateHodlInvoice} className="mb-4">createHodlLnInvoice()</Btn>
                <div className="flex gap-4 mb-4 flex-wrap">
                  <Field label="Payment hash (for claim/cancel)">
                    <input value={hodlPaymentHash} onChange={(e) => setHodlPaymentHash(e.target.value)} className={inputCls} placeholder="hex" />
                  </Field>
                  <Field label="Preimage (for claim)">
                    <input value={hodlPreimage} onChange={(e) => setHodlPreimage(e.target.value)} className={inputCls} placeholder="hex" />
                  </Field>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Btn onClick={handleClaimHodl}>claimHodlInvoice()</Btn>
                  <Btn variant="danger" onClick={handleCancelHodl}>cancelHodlInvoice()</Btn>
                </div>
                <OutputBox value={invoiceOut} />
              </Section>

              {/* ── Payments ──────────────────────────────────────────── */}
              <Section title="16. Lightning — Payments" hint="sendPayment, keysend, listPayments, getPayment">
                <Field label="LN Invoice">
                  <input value={payInvoice} onChange={(e) => setPayInvoice(e.target.value)} className={inputCls} placeholder="lnbc..." />
                </Field>
                <Field label="Amount override (msat, optional)">
                  <input value={payAmtMsat} onChange={(e) => setPayAmtMsat(e.target.value)} className={inputCls} type="number" />
                </Field>
                <Btn onClick={handleSendPayment} className="mb-4">sendPayment()</Btn>
                <div className="flex gap-4 mb-4 flex-wrap">
                  <Field label="Keysend pubkey">
                    <input value={keysendPubkey} onChange={(e) => setKeysendPubkey(e.target.value)} className={inputCls} placeholder="02..." />
                  </Field>
                  <Field label="Keysend amount (msat)">
                    <input value={keysendAmtMsat} onChange={(e) => setKeysendAmtMsat(e.target.value)} className={inputCls} type="number" />
                  </Field>
                </div>
                <div className="flex gap-2 flex-wrap mb-4">
                  <Btn variant="secondary" onClick={handleKeysend}>keysend()</Btn>
                  <Btn variant="secondary" onClick={handleListPayments}>listPayments()</Btn>
                </div>
                <Field label="Get payment by hash">
                  <input value={getPaymentHash} onChange={(e) => setGetPaymentHash(e.target.value)} className={inputCls} placeholder="hex" />
                </Field>
                <Btn variant="secondary" onClick={handleGetPayment}>getPayment(hash)</Btn>
                <OutputBox value={paymentsOut} />
              </Section>
            </>
          ) : (
            <Section title="Lightning (disabled)">
              <p className="text-[#8b949e] text-sm">
                Lightning node is not configured. Set a <code className="text-[#79c0ff]">transportEndpoint</code> when creating the wallet to enable Lightning operations.
              </p>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
