import React, { useState } from 'react';
import type { WalletManager } from '@utexo/rgb-sdk-web';
import { useStore } from '../store';
import { Section } from './Section';
import { Field, inputCls, textareaCls } from './Field';
import { Btn } from './Btn';
import { OutputBox } from './OutputBox';
import { StepFlow } from './StepFlow';
import { json } from '../lib/utils';

interface Props {
  manager: WalletManager;
  walletId: string;
}

export function ManagerOps({ manager, walletId }: Props) {
  const addLog = useStore((s) => s.addLog);
  const updateWallet = useStore((s) => s.updateWallet);

  // Create UTXOs
  const [utxoNum, setUtxoNum] = useState('');
  const [utxoSize, setUtxoSize] = useState('');
  const [utxoFee, setUtxoFee] = useState('');
  const [pendingUtxosPsbt, setPendingUtxosPsbt] = useState<string | null>(null);
  const [signedUtxosPsbt, setSignedUtxosPsbt] = useState<string | null>(null);
  const [utxosOut, setUtxosOut] = useState('');

  // Inflate
  const [inflateAssetId, setInflateAssetId] = useState('');
  const [inflateAmounts, setInflateAmounts] = useState('1000');
  const [inflateFeeRate, setInflateFeeRate] = useState('');
  const [pendingInflatePsbt, setPendingInflatePsbt] = useState<string | null>(null);
  const [signedInflatePsbt, setSignedInflatePsbt] = useState<string | null>(null);
  const [inflateOut, setInflateOut] = useState('');

  // Batch send
  const [batchRecipientMapRaw, setBatchRecipientMapRaw] = useState('{}');
  const [batchFeeRate, setBatchFeeRate] = useState('2');
  const [pendingBatchPsbt, setPendingBatchPsbt] = useState<string | null>(null);
  const [signedBatchPsbt, setSignedBatchPsbt] = useState<string | null>(null);
  const [batchOut, setBatchOut] = useState('');

  // Transfers
  const [transfersAssetId, setTransfersAssetId] = useState('');
  const [failBatchIdx, setFailBatchIdx] = useState('');
  const [failNoAssetOnly, setFailNoAssetOnly] = useState(false);
  const [txOut, setTxOut] = useState('');

  // Crypto
  const [decodeInvoice, setDecodeInvoice] = useState('');
  const [signMsg, setSignMsg] = useState('');
  const [verifyMsg, setVerifyMsg] = useState('');
  const [verifySig, setVerifySig] = useState('');
  const [estimateFeePsbt, setEstimateFeePsbt] = useState('');
  const [cryptoOut, setCryptoOut] = useState('');

  // Outputs
  const [infoOut, setInfoOut] = useState('');
  const [syncOut, setSyncOut] = useState('');
  const [onlineOut, setOnlineOut] = useState('');

  // ── goOnline ─────────────────────────────────────────────────────────────────

  async function handleGoOnline() {
    try {
      addLog('Going online...', 'info');
      await manager.goOnline('');
      updateWallet(walletId, { online: true });
      setOnlineOut('Online');
      addLog('Online', 'ok');
    } catch (e) {
      setOnlineOut('Error: ' + e);
      addLog('Go online failed: ' + e, 'err');
    }
  }

  // ── Wallet Info ───────────────────────────────────────────────────────────────

  async function handleGetAddress() {
    try {
      const addr = await manager.getAddress();
      setInfoOut('Address: ' + addr);
      addLog('Address: ' + addr, 'ok');
    } catch (e) { setInfoOut('Error: ' + e); }
  }

  async function handleGetBalance() {
    try {
      const bal = await manager.getBtcBalance();
      setInfoOut(json(bal));
      addLog('BTC balance retrieved', 'ok');
    } catch (e) { setInfoOut('Error: ' + e); }
  }

  async function handleListUnspents() {
    try {
      const u = await manager.listUnspents();
      setInfoOut(json(u));
      addLog('Unspents: ' + (u?.length ?? 0), 'ok');
    } catch (e) { setInfoOut('Error: ' + e); }
  }

  async function handleListAssets() {
    try {
      const a = await manager.listAssets();
      setInfoOut(json(a));
      addLog('Assets listed', 'ok');
    } catch (e) { setInfoOut('Error: ' + e); }
  }

  function handleGetXpub() {
    setInfoOut(json(manager.getXpub()));
    addLog('xpubs retrieved', 'ok');
  }

  function handleGetNetwork() {
    setInfoOut('Network: ' + manager.getNetwork());
  }

  function handleRegisterWallet() {
    try {
      setInfoOut(json(manager.registerWallet()));
      addLog('Wallet registered', 'ok');
    } catch (e) { setInfoOut('Error: ' + e); }
  }

  // ── Create UTXOs ──────────────────────────────────────────────────────────────

  function utxoParams() {
    return {
      upTo: true,
      num: utxoNum ? parseInt(utxoNum) : undefined,
      size: utxoSize ? parseInt(utxoSize) : undefined,
      feeRate: utxoFee ? parseFloat(utxoFee) : undefined,
    };
  }

  async function handleUtxosBegin() {
    addLog('Create UTXOs begin...', 'info');
    const psbt = await manager.createUtxosBegin(utxoParams());
    setPendingUtxosPsbt(psbt);
    setSignedUtxosPsbt(null);
    setUtxosOut('Step 1 — Unsigned PSBT:\n' + psbt);
    addLog('PSBT ready', 'ok');
  }

  async function handleUtxosSign() {
    if (!pendingUtxosPsbt) { setUtxosOut('Run Step 1 first'); return; }
    const signed = await manager.signPsbt(pendingUtxosPsbt);
    setSignedUtxosPsbt(signed);
    setUtxosOut('Step 2 — Signed PSBT:\n' + signed);
    addLog('UTXOs PSBT signed', 'ok');
  }

  async function handleUtxosEnd() {
    if (!signedUtxosPsbt) { setUtxosOut('Sign PSBT first'); return; }
    addLog('Create UTXOs end (broadcast)...', 'info');
    const result = await manager.createUtxosEnd({ signedPsbt: signedUtxosPsbt });
    setPendingUtxosPsbt(null); setSignedUtxosPsbt(null);
    setUtxosOut('UTXOs created: ' + json(result));
    addLog('UTXOs created', 'ok');
  }

  async function handleUtxosAuto() {
    const result = await manager.createUtxos(utxoParams());
    setUtxosOut('UTXOs created: ' + json(result));
    addLog('UTXOs created (auto)', 'ok');
  }

  // ── Sync ──────────────────────────────────────────────────────────────────────

  async function handleSync() {
    try {
      addLog('Syncing wallet...', 'info');
      await manager.syncWallet();
      setSyncOut('Wallet synced');
      addLog('Wallet synced', 'ok');
    } catch (e) { setSyncOut('Error: ' + e); }
  }

  async function handleRefresh() {
    try {
      addLog('Refreshing wallet...', 'info');
      await manager.refreshWallet();
      setSyncOut('Wallet refreshed');
      addLog('Wallet refreshed', 'ok');
    } catch (e) { setSyncOut('Error: ' + e); }
  }

  // ── Transactions & Transfers ──────────────────────────────────────────────────

  async function handleListTransactions() {
    try {
      addLog('Listing transactions...', 'info');
      const txs = await manager.listTransactions();
      setTxOut(json(txs));
      addLog('Transactions: ' + txs?.length, 'ok');
    } catch (e) { setTxOut('Error: ' + e); }
  }

  async function handleListTransfers() {
    try {
      addLog('Listing transfers...', 'info');
      const transfers = await manager.listTransfers(transfersAssetId.trim() || undefined);
      setTxOut(json(transfers));
      addLog('Transfers: ' + transfers?.length, 'ok');
    } catch (e) { setTxOut('Error: ' + e); }
  }

  async function handleFailTransfers() {
    try {
      addLog('Failing transfers...', 'info');
      const result = await manager.failTransfers({
        batchTransferIdx: failBatchIdx ? parseInt(failBatchIdx) : undefined,
        noAssetOnly: failNoAssetOnly || undefined,
      });
      setTxOut('failTransfers result: ' + json(result));
      addLog('failTransfers done', 'ok');
    } catch (e) { setTxOut('Error: ' + e); }
  }

  // ── Inflate IFA ───────────────────────────────────────────────────────────────

  function inflateParams() {
    return {
      assetId: inflateAssetId.trim(),
      inflationAmounts: inflateAmounts.split(',').map((s) => parseInt(s.trim())).filter(Boolean),
      feeRate: inflateFeeRate ? parseFloat(inflateFeeRate) : undefined,
    };
  }

  async function handleInflateBegin() {
    if (!inflateAssetId.trim()) { setInflateOut('Enter asset ID'); return; }
    addLog('Inflate begin...', 'info');
    const psbt = await manager.inflateBegin(inflateParams());
    setPendingInflatePsbt(psbt);
    setSignedInflatePsbt(null);
    setInflateOut('Step 1 — Unsigned PSBT:\n' + psbt);
    addLog('Inflate PSBT ready', 'ok');
  }

  async function handleInflateSign() {
    if (!pendingInflatePsbt) { setInflateOut('Run Step 1 first'); return; }
    const signed = await manager.signPsbt(pendingInflatePsbt);
    setSignedInflatePsbt(signed);
    setInflateOut('Step 2 — Signed PSBT:\n' + signed);
    addLog('Inflate PSBT signed', 'ok');
  }

  async function handleInflateEnd() {
    if (!signedInflatePsbt) { setInflateOut('Sign PSBT first'); return; }
    addLog('Inflate end (broadcast)...', 'info');
    const result = await manager.inflateEnd({ signedPsbt: signedInflatePsbt });
    setPendingInflatePsbt(null); setSignedInflatePsbt(null);
    setInflateOut('Inflate result: ' + json(result));
    addLog('Inflate broadcast', 'ok');
  }

  async function handleInflateAuto() {
    if (!inflateAssetId.trim()) { setInflateOut('Enter asset ID'); return; }
    addLog('Inflate (auto)...', 'info');
    const result = await manager.inflate(inflateParams());
    setInflateOut('Inflate result: ' + json(result));
    addLog('Inflate done (auto)', 'ok');
  }

  // ── Batch Send ────────────────────────────────────────────────────────────────

  function parseBatchParams() {
    let recipientMap: Record<string, unknown[]> = {};
    try { recipientMap = JSON.parse(batchRecipientMapRaw); } catch { throw new Error('Invalid recipientMap JSON'); }
    return { recipientMap, feeRate: parseFloat(batchFeeRate) || 2 };
  }

  async function handleBatchBegin() {
    addLog('Batch send begin...', 'info');
    const psbt = await manager.sendBeginBatch(parseBatchParams() as Parameters<typeof manager.sendBeginBatch>[0]);
    setPendingBatchPsbt(psbt);
    setSignedBatchPsbt(null);
    setBatchOut('Step 1 — Unsigned PSBT:\n' + psbt);
    addLog('Batch PSBT ready', 'ok');
  }

  async function handleBatchSign() {
    if (!pendingBatchPsbt) { setBatchOut('Run Step 1 first'); return; }
    const signed = await manager.signPsbt(pendingBatchPsbt);
    setSignedBatchPsbt(signed);
    setBatchOut('Step 2 — Signed PSBT:\n' + signed);
    addLog('Batch PSBT signed', 'ok');
  }

  async function handleBatchEnd() {
    if (!signedBatchPsbt) { setBatchOut('Sign PSBT first'); return; }
    addLog('Batch send end...', 'info');
    const result = await manager.sendEnd({ signedPsbt: signedBatchPsbt });
    setPendingBatchPsbt(null); setSignedBatchPsbt(null);
    setBatchOut('Batch result: ' + json(result));
    addLog('Batch sent', 'ok');
  }

  async function handleBatchAuto() {
    addLog('Batch send (auto)...', 'info');
    const result = await manager.sendBatch(parseBatchParams() as Parameters<typeof manager.sendBatch>[0]);
    setBatchOut('Batch result: ' + json(result));
    addLog('Batch sent (auto)', 'ok');
  }

  // ── Crypto & Decode ───────────────────────────────────────────────────────────

  async function handleDecodeInvoice() {
    if (!decodeInvoice.trim()) { setCryptoOut('Enter an invoice'); return; }
    try {
      addLog('Decoding RGB invoice...', 'info');
      const result = await manager.decodeRGBInvoice({ invoice: decodeInvoice.trim() });
      setCryptoOut(json(result));
      addLog('Invoice decoded', 'ok');
    } catch (e) { setCryptoOut('Error: ' + e); }
  }

  async function handleSignMessage() {
    if (!signMsg.trim()) { setCryptoOut('Enter a message'); return; }
    try {
      addLog('Signing message...', 'info');
      const sig = await manager.signMessage(signMsg.trim());
      setCryptoOut('Signature:\n' + sig);
      addLog('Message signed', 'ok');
    } catch (e) { setCryptoOut('Error: ' + e); }
  }

  async function handleVerifyMessage() {
    if (!verifyMsg.trim() || !verifySig.trim()) { setCryptoOut('Enter message and signature'); return; }
    try {
      addLog('Verifying message...', 'info');
      const valid = await manager.verifyMessage(verifyMsg.trim(), verifySig.trim());
      setCryptoOut('Valid: ' + valid);
      addLog('Verify: ' + valid, valid ? 'ok' : 'warn');
    } catch (e) { setCryptoOut('Error: ' + e); }
  }

  async function handleEstimateFee() {
    if (!estimateFeePsbt.trim()) { setCryptoOut('Enter a PSBT (base64)'); return; }
    try {
      addLog('Estimating fee for PSBT...', 'info');
      const result = await manager.estimateFee(estimateFeePsbt.trim());
      setCryptoOut(json(result));
      addLog('Fee estimated', 'ok');
    } catch (e) { setCryptoOut('Error: ' + e); }
  }

  return (
    <>
      {/* goOnline */}
      <Section title="goOnline()" hint="Connects using the indexer URL set at create() time.">
        <Btn variant="accent" onClick={handleGoOnline}>goOnline()</Btn>
        <OutputBox value={onlineOut} />
      </Section>

      {/* Wallet Info */}
      <Section title="Wallet Info">
        <div className="flex gap-2 flex-wrap mb-2">
          <Btn onClick={handleGetAddress}>getAddress()</Btn>
          <Btn onClick={handleGetBalance}>getBtcBalance()</Btn>
          <Btn variant="secondary" onClick={handleListUnspents}>listUnspents()</Btn>
          <Btn variant="secondary" onClick={handleListAssets}>listAssets()</Btn>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Btn variant="secondary" onClick={handleGetXpub}>getXpub()</Btn>
          <Btn variant="secondary" onClick={handleGetNetwork}>getNetwork()</Btn>
          <Btn variant="secondary" onClick={handleRegisterWallet}>registerWallet()</Btn>
        </div>
        <OutputBox value={infoOut} />
      </Section>

      {/* Create UTXOs */}
      <Section title="createUtxosBegin / createUtxosEnd / createUtxos">
        <div className="flex gap-4 mb-4 flex-wrap">
          <Field label="num (optional)">
            <input type="number" value={utxoNum} onChange={(e) => setUtxoNum(e.target.value)} className={inputCls} placeholder="e.g. 1" min="1" />
          </Field>
          <Field label="size sats (optional)">
            <input type="number" value={utxoSize} onChange={(e) => setUtxoSize(e.target.value)} className={inputCls} placeholder="e.g. 1000" />
          </Field>
          <Field label="feeRate sat/vB (optional)">
            <input type="number" value={utxoFee} onChange={(e) => setUtxoFee(e.target.value)} className={inputCls} placeholder="e.g. 2" step="0.1" />
          </Field>
        </div>
        <StepFlow
          steps={[
            { label: '1. createUtxosBegin()', onClick: handleUtxosBegin },
            { label: '2. signPsbt()', variant: 'warning', onClick: handleUtxosSign },
            { label: '3. createUtxosEnd()', variant: 'accent', onClick: handleUtxosEnd },
          ]}
          auto={{ label: 'createUtxos() auto', onClick: handleUtxosAuto }}
        />
        <OutputBox value={utxosOut} />
      </Section>

      {/* Sync */}
      <Section title="syncWallet / refreshWallet">
        <div className="flex gap-2 flex-wrap">
          <Btn onClick={handleSync}>syncWallet()</Btn>
          <Btn variant="secondary" onClick={handleRefresh}>refreshWallet()</Btn>
        </div>
        <OutputBox value={syncOut} />
      </Section>

      {/* Transactions & Transfers */}
      <Section title="listTransactions / listTransfers / failTransfers">
        <div className="flex gap-2 flex-wrap mb-4">
          <Btn onClick={handleListTransactions}>listTransactions()</Btn>
        </div>
        <div className="flex gap-4 items-end flex-wrap mb-4">
          <Field label="Asset ID (optional)">
            <input value={transfersAssetId} onChange={(e) => setTransfersAssetId(e.target.value)} className={inputCls} placeholder="rgb:..." />
          </Field>
          <Btn variant="secondary" onClick={handleListTransfers} className="mb-4">listTransfers(assetId?)</Btn>
        </div>
        <div className="flex gap-4 items-end flex-wrap">
          <Field label="batchTransferIdx (optional)">
            <input type="number" value={failBatchIdx} onChange={(e) => setFailBatchIdx(e.target.value)} className={inputCls} />
          </Field>
          <Field label="noAssetOnly">
            <div className="flex items-center gap-2 mt-2">
              <input type="checkbox" checked={failNoAssetOnly} onChange={(e) => setFailNoAssetOnly(e.target.checked)} id="failNoAsset" />
              <label htmlFor="failNoAsset" className="text-sm text-[#8b949e]">noAssetOnly</label>
            </div>
          </Field>
          <Btn variant="danger" onClick={handleFailTransfers} className="mb-4">failTransfers()</Btn>
        </div>
        <OutputBox value={txOut} />
      </Section>

      {/* Inflate IFA */}
      <Section title="inflateBegin / inflateEnd / inflate (IFA only)">
        <div className="flex gap-4 mb-4 flex-wrap">
          <Field label="Asset ID">
            <input value={inflateAssetId} onChange={(e) => setInflateAssetId(e.target.value)} className={inputCls} placeholder="rgb:..." />
          </Field>
          <Field label="inflationAmounts (comma-separated)">
            <input value={inflateAmounts} onChange={(e) => setInflateAmounts(e.target.value)} className={inputCls} />
          </Field>
          <Field label="feeRate (optional)">
            <input type="number" value={inflateFeeRate} onChange={(e) => setInflateFeeRate(e.target.value)} className={inputCls} step="0.1" />
          </Field>
        </div>
        <StepFlow
          steps={[
            { label: '1. inflateBegin()', onClick: handleInflateBegin },
            { label: '2. signPsbt()', variant: 'warning', onClick: handleInflateSign },
            { label: '3. inflateEnd()', variant: 'accent', onClick: handleInflateEnd },
          ]}
          auto={{ label: 'inflate() auto', onClick: handleInflateAuto }}
        />
        <OutputBox value={inflateOut} />
      </Section>

      {/* Batch Send */}
      <Section title="sendBeginBatch / sendBatch" hint="recipientMap: { assetId: [{ recipientId, amount }, ...] }">
        <Field label="recipientMap (JSON)">
          <textarea value={batchRecipientMapRaw} onChange={(e) => setBatchRecipientMapRaw(e.target.value)} className={textareaCls} rows={4} />
        </Field>
        <Field label="feeRate">
          <input type="number" value={batchFeeRate} onChange={(e) => setBatchFeeRate(e.target.value)} className={inputCls} step="0.1" />
        </Field>
        <StepFlow
          steps={[
            { label: '1. sendBeginBatch()', onClick: handleBatchBegin },
            { label: '2. signPsbt()', variant: 'warning', onClick: handleBatchSign },
            { label: '3. sendEnd()', variant: 'accent', onClick: handleBatchEnd },
          ]}
          auto={{ label: 'sendBatch() auto', onClick: handleBatchAuto }}
        />
        <OutputBox value={batchOut} />
      </Section>

      {/* Crypto */}
      <Section title="decodeRGBInvoice / signMessage / verifyMessage / estimateFee">
        <Field label="RGB Invoice to decode">
          <input value={decodeInvoice} onChange={(e) => setDecodeInvoice(e.target.value)} className={inputCls} placeholder="rgb:..." />
        </Field>
        <Btn variant="secondary" onClick={handleDecodeInvoice} className="mb-4">decodeRGBInvoice()</Btn>

        <Field label="Message to sign">
          <input value={signMsg} onChange={(e) => setSignMsg(e.target.value)} className={inputCls} placeholder="Hello World" />
        </Field>
        <Btn variant="secondary" onClick={handleSignMessage} className="mb-4">signMessage()</Btn>

        <div className="flex gap-4 flex-wrap">
          <Field label="Message to verify">
            <input value={verifyMsg} onChange={(e) => setVerifyMsg(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Signature">
            <input value={verifySig} onChange={(e) => setVerifySig(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <Btn variant="secondary" onClick={handleVerifyMessage} className="mb-4">verifyMessage()</Btn>

        <Field label="PSBT base64 for fee estimation">
          <textarea value={estimateFeePsbt} onChange={(e) => setEstimateFeePsbt(e.target.value)} className={textareaCls} rows={2} placeholder="cHNidP8B..." />
        </Field>
        <Btn variant="secondary" onClick={handleEstimateFee} className="mb-4">estimateFee(psbt)</Btn>

        <OutputBox value={cryptoOut} />
      </Section>
    </>
  );
}
