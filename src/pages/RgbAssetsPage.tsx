import React, { useState } from 'react';
import type { WalletManager } from '@utexo/rgb-sdk-web';
import { useStore } from '../store';
import { Section } from '../components/Section';
import { Field, inputCls, selectCls, textareaCls } from '../components/Field';
import { Btn } from '../components/Btn';
import { OutputBox } from '../components/OutputBox';
import { StepFlow } from '../components/StepFlow';
import { useActiveWallet } from '../hooks/useActiveWallet';
import { json, parseAmounts } from '../lib/utils';

export function RgbAssetsPage() {
  const addLog = useStore((s) => s.addLog);
  const activeWallet = useActiveWallet();
  const wallet = activeWallet?.instance ?? null;
  const isManager = activeWallet?.type === 'manager';

  const [assetIdQuery, setAssetIdQuery] = useState('');
  const [niaTicker, setNiaTicker] = useState('DEMO');
  const [niaName, setNiaName] = useState('Demo Token');
  const [niaPrecision, setNiaPrecision] = useState('0');
  const [niaAmounts, setNiaAmounts] = useState('1000');

  const [ifaTicker, setIfaTicker] = useState('INFL');
  const [ifaName, setIfaName] = useState('Inflatable Token');
  const [ifaPrecision, setIfaPrecision] = useState('0');
  const [ifaAmounts, setIfaAmounts] = useState('500');
  const [ifaInflationAmounts, setIfaInflationAmounts] = useState('1000');
  const [ifaReplaceRights, setIfaReplaceRights] = useState('0');

  const [recvAssetId, setRecvAssetId] = useState('');
  const [recvAmount, setRecvAmount] = useState('');
  const [recvDuration, setRecvDuration] = useState('');

  const [sendInvoice, setSendInvoice] = useState('');
  const [sendAssetId, setSendAssetId] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendDonation, setSendDonation] = useState('false');
  const [sendFeeRate, setSendFeeRate] = useState('2');
  const [sendMinConf, setSendMinConf] = useState('1');
  const [sendWitnessAmountSat, setSendWitnessAmountSat] = useState('1000');
  const [sendUseWitnessData, setSendUseWitnessData] = useState(false);

  const [inflateAssetId, setInflateAssetId] = useState('');
  const [inflateAmounts, setInflateAmounts] = useState('100');

  const [txAssetId, setTxAssetId] = useState('');
  const [failBatchIdx, setFailBatchIdx] = useState('');

  const [decodeInvoice, setDecodeInvoice] = useState('');
  const [signMsg, setSignMsg] = useState('');
  const [verifyMsg, setVerifyMsg] = useState('');
  const [verifySig, setVerifySig] = useState('');
  const [verifyXpub, setVerifyXpub] = useState('');

  const [batchRecipientMap, setBatchRecipientMap] = useState('{}');
  const [batchFeeRate, setBatchFeeRate] = useState('2');
  const [batchDonation, setBatchDonation] = useState('false');

  const [listOut, setListOut] = useState('');
  const [niaOut, setNiaOut] = useState('');
  const [ifaOut, setIfaOut] = useState('');
  const [recvOut, setRecvOut] = useState('');
  const [sendOut, setSendOut] = useState('');
  const [inflateOut, setInflateOut] = useState('');
  const [txOut, setTxOut] = useState('');
  const [decodeOut, setDecodeOut] = useState('');
  const [signOut, setSignOut] = useState('');
  const [batchOut, setBatchOut] = useState('');

  const [pendingPsbt, setPendingPsbt] = useState<string | null>(null);
  const [signedPsbt, setSignedPsbt] = useState<string | null>(null);
  const [inflatePendingPsbt, setInflatePendingPsbt] = useState<string | null>(null);
  const [inflateSignedPsbt, setInflateSignedPsbt] = useState<string | null>(null);
  const [batchPendingPsbt, setBatchPendingPsbt] = useState<string | null>(null);
  const [batchSignedPsbt, setBatchSignedPsbt] = useState<string | null>(null);

  const active = !!wallet;

  async function handleListAssets() {
    if (!wallet) { setListOut('Create a wallet first'); return; }
    try {
      addLog('Listing assets...', 'info');
      const assets = await wallet.listAssets();
      setListOut(json(assets));
      addLog('Assets listed', 'ok');
    } catch (e) { setListOut('Error: ' + e); addLog('List assets failed: ' + e, 'err'); }
  }

  async function handleGetAssetBalance() {
    if (!wallet) { setListOut('Create a wallet first'); return; }
    if (!assetIdQuery.trim()) { setListOut('Enter an asset ID'); return; }
    try {
      addLog('Getting asset balance...', 'info');
      const balance = await wallet.getAssetBalance(assetIdQuery.trim());
      setListOut(json(balance));
      addLog('Asset balance retrieved', 'ok');
    } catch (e) { setListOut('Error: ' + e); }
  }

  async function handleRefreshWallet() {
    if (!wallet) { setListOut('Create a wallet first'); return; }
    try {
      addLog('Refreshing wallet...', 'info');
      await wallet.refreshWallet();
      setListOut('Wallet refreshed');
      addLog('Wallet refreshed', 'ok');
    } catch (e) { setListOut('Error: ' + e); }
  }

  async function handleIssueNia() {
    if (!wallet) { setNiaOut('Create a wallet first'); return; }
    const ticker = niaTicker.trim().toUpperCase();
    const name = niaName.trim();
    const amounts = parseAmounts(niaAmounts);
    if (!ticker || !name || amounts.length === 0) { setNiaOut('Fill in ticker, name, and amounts'); return; }
    try {
      addLog('Issuing NIA ' + ticker + '...', 'info');
      const asset = await wallet.issueAssetNia({ ticker, name, precision: parseInt(niaPrecision) || 0, amounts });
      setNiaOut(json(asset));
      const assetId = (asset as { assetId?: string; asset_id?: string }).assetId ?? (asset as { asset_id?: string }).asset_id ?? '';
      setAssetIdQuery(assetId);
      addLog('NIA issued: ' + assetId, 'ok');
    } catch (e) { setNiaOut('Error: ' + e); addLog('Issue NIA failed: ' + e, 'err'); }
  }

  async function handleIssueIfa() {
    if (!wallet) { setIfaOut('Create a wallet first'); return; }
    const ticker = ifaTicker.trim().toUpperCase();
    const name = ifaName.trim();
    const amounts = parseAmounts(ifaAmounts);
    const inflationAmounts = parseAmounts(ifaInflationAmounts);
    if (!ticker || !name || amounts.length === 0) { setIfaOut('Fill in ticker, name, and amounts'); return; }
    try {
      addLog('Issuing IFA ' + ticker + '...', 'info');
      const asset = await wallet.issueAssetIfa({ ticker, name, precision: parseInt(ifaPrecision) || 0, amounts, inflationAmounts, replaceRightsNum: parseInt(ifaReplaceRights) || 0, rejectListUrl: null });
      setIfaOut(json(asset));
      addLog('IFA issued', 'ok');
    } catch (e) { setIfaOut('Error: ' + e); addLog('Issue IFA failed: ' + e, 'err'); }
  }

  function buildReceiveParams() {
    return {
      assetId: recvAssetId.trim() || undefined,
      amount: recvAmount ? parseInt(recvAmount) : undefined,
      durationSeconds: recvDuration ? parseInt(recvDuration) : undefined,
    };
  }

  async function handleBlindReceive() {
    if (!wallet) { setRecvOut('Create a wallet first'); return; }
    try {
      addLog('Creating blind receive...', 'info');
      const result = await wallet.blindReceive(buildReceiveParams());
      setRecvOut(json(result));
      addLog('Blind receive created', 'ok');
    } catch (e) { setRecvOut('Error: ' + e); addLog('Blind receive failed: ' + e, 'err'); }
  }

  async function handleWitnessReceive() {
    if (!wallet) { setRecvOut('Create a wallet first'); return; }
    try {
      addLog('Creating witness receive...', 'info');
      const result = await wallet.witnessReceive(buildReceiveParams());
      setRecvOut(json(result));
      addLog('Witness receive created', 'ok');
    } catch (e) { setRecvOut('Error: ' + e); addLog('Witness receive failed: ' + e, 'err'); }
  }

  function sendParams() {
    return {
      invoice: sendInvoice.trim(),
      assetId: sendAssetId.trim() || undefined,
      amount: sendAmount ? parseInt(sendAmount) : undefined,
      donation: sendDonation === 'true',
      feeRate: parseFloat(sendFeeRate) || 2,
      minConfirmations: sendMinConf ? parseInt(sendMinConf) : undefined,
      witnessData: sendUseWitnessData ? { amountSat: parseInt(sendWitnessAmountSat) || 1000 } : undefined,
    };
  }

  async function handleSendBegin() {
    if (!wallet) { setSendOut('Create a wallet first'); return; }
    if (!sendInvoice.trim()) { setSendOut('Enter recipient invoice'); return; }
    addLog('Send assets begin...', 'info');
    const psbt = await wallet.sendBegin(sendParams());
    setPendingPsbt(psbt);
    setSignedPsbt(null);
    setSendOut('Step 1 — Unsigned PSBT:\n' + psbt);
    addLog('Send begin — PSBT ready', 'ok');
  }

  async function handleSignSend() {
    if (!wallet || !pendingPsbt) { setSendOut('Run Step 1 first'); return; }
    addLog('Signing PSBT...', 'info');
    const signed = await wallet.signPsbt(pendingPsbt);
    setSignedPsbt(signed);
    setSendOut('Step 2 — Signed PSBT:\n' + signed);
    addLog('PSBT signed', 'ok');
  }

  async function handleSendEnd() {
    if (!wallet || !signedPsbt) { setSendOut('Sign PSBT first'); return; }
    addLog('Send assets end (broadcast)...', 'info');
    const result = await wallet.sendEnd({ signedPsbt });
    setPendingPsbt(null);
    setSignedPsbt(null);
    setSendOut('Step 3 — Result:\n' + json(result));
    addLog('Transfer submitted', 'ok');
  }

  async function handleSendAuto() {
    if (!wallet) { setSendOut('Create a wallet first'); return; }
    if (!sendInvoice.trim()) { setSendOut('Enter recipient invoice'); return; }
    addLog('Sending assets (auto)...', 'info');
    const result = await wallet.send(sendParams());
    setSendOut('Result (auto):\n' + json(result));
    addLog('Transfer submitted (auto)', 'ok');
  }

  // Inflate
  function inflateParams() {
    return { assetId: inflateAssetId.trim(), inflationAmounts: parseAmounts(inflateAmounts) };
  }

  async function handleInflateBegin() {
    if (!wallet) { setInflateOut('Create a wallet first'); return; }
    if (!inflateAssetId.trim()) { setInflateOut('Enter asset ID'); return; }
    addLog('Inflate begin...', 'info');
    const psbt = await wallet.inflateBegin(inflateParams());
    setInflatePendingPsbt(psbt);
    setInflateSignedPsbt(null);
    setInflateOut('Step 1 — Unsigned PSBT:\n' + psbt);
    addLog('Inflate PSBT ready', 'ok');
  }

  async function handleInflateSign() {
    if (!wallet || !inflatePendingPsbt) { setInflateOut('Run Step 1 first'); return; }
    addLog('Signing inflate PSBT...', 'info');
    const signed = await wallet.signPsbt(inflatePendingPsbt);
    setInflateSignedPsbt(signed);
    setInflateOut('Step 2 — Signed PSBT:\n' + signed);
    addLog('Inflate PSBT signed', 'ok');
  }

  async function handleInflateEnd() {
    if (!wallet || !inflateSignedPsbt) { setInflateOut('Sign PSBT first'); return; }
    addLog('Inflate end (broadcast)...', 'info');
    const result = await wallet.inflateEnd({ signedPsbt: inflateSignedPsbt });
    setInflatePendingPsbt(null); setInflateSignedPsbt(null);
    setInflateOut('Result:\n' + json(result));
    addLog('Inflate complete', 'ok');
  }

  async function handleInflateAuto() {
    if (!wallet) { setInflateOut('Create a wallet first'); return; }
    if (!inflateAssetId.trim()) { setInflateOut('Enter asset ID'); return; }
    addLog('Inflate (auto)...', 'info');
    const result = await wallet.inflate(inflateParams());
    setInflateOut('Result (auto):\n' + json(result));
    addLog('Inflate complete (auto)', 'ok');
  }

  // Transactions & Transfers
  async function handleListTransactions() {
    if (!wallet) { setTxOut('Create a wallet first'); return; }
    try {
      addLog('Listing transactions...', 'info');
      const result = await wallet.listTransactions();
      setTxOut(json(result));
      addLog('Transactions: ' + (result?.length ?? 0), 'ok');
    } catch (e) { setTxOut('Error: ' + e); addLog('listTransactions failed: ' + e, 'err'); }
  }

  async function handleListTransfers() {
    if (!wallet) { setTxOut('Create a wallet first'); return; }
    try {
      addLog('Listing transfers...', 'info');
      const result = await wallet.listTransfers(txAssetId.trim() || undefined);
      setTxOut(json(result));
      addLog('Transfers: ' + (result?.length ?? 0), 'ok');
    } catch (e) { setTxOut('Error: ' + e); addLog('listTransfers failed: ' + e, 'err'); }
  }

  async function handleFailTransfers() {
    if (!wallet) { setTxOut('Create a wallet first'); return; }
    try {
      addLog('Failing transfers...', 'info');
      const batchIdx = failBatchIdx.trim() ? parseInt(failBatchIdx.trim()) : undefined;
      const result = await wallet.failTransfers({ batchTransferIdx: Number.isFinite(batchIdx) ? batchIdx : undefined });
      setTxOut('failTransfers result: ' + json(result));
      addLog('failTransfers: ' + result, 'ok');
    } catch (e) { setTxOut('Error: ' + e); addLog('failTransfers failed: ' + e, 'err'); }
  }

  // Decode / Sign / Verify
  async function handleDecodeInvoice() {
    if (!wallet) { setDecodeOut('Create a wallet first'); return; }
    if (!decodeInvoice.trim()) { setDecodeOut('Enter an invoice'); return; }
    try {
      addLog('Decoding RGB invoice...', 'info');
      const result = await wallet.decodeRGBInvoice({ invoice: decodeInvoice.trim() });
      setDecodeOut(json(result));
      addLog('Invoice decoded', 'ok');
    } catch (e) { setDecodeOut('Error: ' + e); addLog('decodeRGBInvoice failed: ' + e, 'err'); }
  }

  async function handleSignMessage() {
    if (!wallet) { setSignOut('Create a wallet first'); return; }
    if (!signMsg.trim()) { setSignOut('Enter a message'); return; }
    try {
      addLog('Signing message...', 'info');
      const sig = await wallet.signMessage(signMsg.trim());
      setSignOut('Signature:\n' + sig);
      setVerifySig(sig);
      setVerifyMsg(signMsg.trim());
      addLog('Message signed', 'ok');
    } catch (e) { setSignOut('Error: ' + e); addLog('signMessage failed: ' + e, 'err'); }
  }

  async function handleVerifyMessage() {
    if (!wallet) { setSignOut('Create a wallet first'); return; }
    if (!verifyMsg.trim() || !verifySig.trim()) { setSignOut('Enter message and signature'); return; }
    try {
      addLog('Verifying message...', 'info');
      const valid = await wallet.verifyMessage(verifyMsg.trim(), verifySig.trim(), verifyXpub.trim() || undefined);
      setSignOut('Verification result: ' + (valid ? 'VALID' : 'INVALID'));
      addLog('Verify: ' + valid, 'ok');
    } catch (e) { setSignOut('Error: ' + e); addLog('verifyMessage failed: ' + e, 'err'); }
  }

  // Batch Send (WalletManager only)
  const manager = isManager ? activeWallet!.instance as WalletManager : null;

  async function handleBatchBegin() {
    if (!manager) { setBatchOut('WalletManager required for batch send'); return; }
    addLog('Batch send begin...', 'info');
    try {
      const params = { recipientMap: JSON.parse(batchRecipientMap) as any, feeRate: parseFloat(batchFeeRate) || 2, donation: batchDonation === 'true' };
      const psbt = await manager.sendBeginBatch(params);
      setBatchPendingPsbt(psbt);
      setBatchSignedPsbt(null);
      setBatchOut('Step 1 — Unsigned PSBT:\n' + psbt);
      addLog('Batch PSBT ready', 'ok');
    } catch (e) { setBatchOut('Error: ' + e); addLog('sendBeginBatch failed: ' + e, 'err'); }
  }

  async function handleBatchSign() {
    if (!manager || !batchPendingPsbt) { setBatchOut('Run Step 1 first'); return; }
    addLog('Signing batch PSBT...', 'info');
    const signed = await manager.signPsbt(batchPendingPsbt);
    setBatchSignedPsbt(signed);
    setBatchOut('Step 2 — Signed PSBT:\n' + signed);
    addLog('Batch PSBT signed', 'ok');
  }

  async function handleBatchEnd() {
    if (!manager || !batchSignedPsbt) { setBatchOut('Sign PSBT first'); return; }
    addLog('Batch send end (broadcast)...', 'info');
    const result = await manager.sendEnd({ signedPsbt: batchSignedPsbt });
    setBatchPendingPsbt(null); setBatchSignedPsbt(null);
    setBatchOut('Result:\n' + json(result));
    addLog('Batch transfer submitted', 'ok');
  }

  async function handleBatchAuto() {
    if (!manager) { setBatchOut('WalletManager required for batch send'); return; }
    addLog('Batch send (auto)...', 'info');
    try {
      const params = { recipientMap: JSON.parse(batchRecipientMap) as any, feeRate: parseFloat(batchFeeRate) || 2, donation: batchDonation === 'true' };
      const result = await manager.sendBatch(params);
      setBatchOut('Result (auto):\n' + json(result));
      addLog('Batch transfer submitted (auto)', 'ok');
    } catch (e) { setBatchOut('Error: ' + e); addLog('sendBatch failed: ' + e, 'err'); }
  }

  return (
    <div>
      <h1 className="text-[#58a6ff] text-2xl font-bold mb-1">RGB Assets</h1>
      <p className="text-[#8b949e] text-sm mb-6">
        Issue, receive, and send RGB assets — uses the active wallet
      </p>

      {!active && (
        <div className="bg-[#1c1f26] text-[#d29922] text-sm px-3 py-2 rounded mb-6">
          Create a wallet first (Wallet page).
        </div>
      )}

      {/* 1. List Assets */}
      <Section title="1. List Assets">
        <div className="flex gap-2 flex-wrap mb-4">
          <Btn onClick={handleListAssets} disabled={!active}>List All Assets</Btn>
          <Btn variant="secondary" onClick={handleRefreshWallet} disabled={!active}>Refresh Wallet</Btn>
        </div>
        <div className="flex gap-4 items-end flex-wrap">
          <Field label="Asset ID (for balance lookup)">
            <input value={assetIdQuery} onChange={(e) => setAssetIdQuery(e.target.value)} className={inputCls} placeholder="rgb:..." />
          </Field>
          <Btn variant="secondary" onClick={handleGetAssetBalance} disabled={!active} className="mb-4">Get Asset Balance</Btn>
        </div>
        <OutputBox value={listOut} />
      </Section>

      {/* 2. Issue NIA */}
      <Section title="2. Issue NIA Asset (Fungible)" hint="NIA = Non-Inflatable Asset. Fixed supply fungible token.">
        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="Ticker">
            <input value={niaTicker} onChange={(e) => setNiaTicker(e.target.value)} className={inputCls} maxLength={8} style={{ textTransform: 'uppercase' }} />
          </Field>
          <Field label="Name">
            <input value={niaName} onChange={(e) => setNiaName(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <div className="flex gap-4 mb-4 flex-wrap">
          <Field label="Precision (decimal places)">
            <input type="number" value={niaPrecision} onChange={(e) => setNiaPrecision(e.target.value)} className={inputCls} min="0" max="18" />
          </Field>
          <Field label="Amounts (comma-separated)">
            <input value={niaAmounts} onChange={(e) => setNiaAmounts(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <Btn onClick={handleIssueNia} disabled={!active}>Issue NIA</Btn>
        <OutputBox label="Issued Asset" value={niaOut} />
      </Section>

      {/* 3. Issue IFA */}
      <Section title="3. Issue IFA Asset (Inflatable Fungible)" hint="IFA = Inflatable Fungible Asset. Supply can be increased.">
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
        <Btn onClick={handleIssueIfa} disabled={!active}>Issue IFA</Btn>
        <OutputBox label="Issued Asset" value={ifaOut} />
      </Section>

      {/* 4. Receive */}
      <Section title="4. Receive RGB Assets" hint="Generate a blind or witness receive invoice. Share with the sender.">
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
        </div>
        <div className="flex gap-2 flex-wrap">
          <Btn onClick={handleBlindReceive} disabled={!active}>Blind Receive</Btn>
          <Btn variant="secondary" onClick={handleWitnessReceive} disabled={!active}>Witness Receive</Btn>
        </div>
        <OutputBox label="Invoice" value={recvOut} />
      </Section>

      {/* 5. Decode Invoice */}
      <Section title="5. Decode RGB Invoice" hint="decodeRGBInvoice — inspect an invoice before sending.">
        <Field label="RGB invoice">
          <input value={decodeInvoice} onChange={(e) => setDecodeInvoice(e.target.value)} className={inputCls} placeholder="rgb:..." />
        </Field>
        <Btn variant="secondary" onClick={handleDecodeInvoice} disabled={!active}>Decode RGB Invoice</Btn>
        <OutputBox value={decodeOut} />
      </Section>

      {/* 6. Send Assets */}
      <Section title="6. Send RGB Assets" hint="Three-step transfer with explicit PSBT signing, or use Send (auto) for one click.">
        <Field label="Recipient invoice (blind/witness receive)">
          <input value={sendInvoice} onChange={(e) => setSendInvoice(e.target.value)} className={inputCls} placeholder="rgb:..." />
        </Field>
        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="Asset ID (optional — inferred from invoice if omitted)">
            <input value={sendAssetId} onChange={(e) => setSendAssetId(e.target.value)} className={inputCls} placeholder="rgb:..." />
          </Field>
          <Field label="Amount (optional)">
            <input type="number" value={sendAmount} onChange={(e) => setSendAmount(e.target.value)} className={inputCls} placeholder="100" min="1" />
          </Field>
        </div>
        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="Fee rate (sat/vB)">
            <input type="number" value={sendFeeRate} onChange={(e) => setSendFeeRate(e.target.value)} className={inputCls} step="0.1" min="1" />
          </Field>
          <Field label="Min confirmations">
            <input type="number" value={sendMinConf} onChange={(e) => setSendMinConf(e.target.value)} className={inputCls} min="0" />
          </Field>
          <Field label="Donation mode">
            <select value={sendDonation} onChange={(e) => setSendDonation(e.target.value)} className={selectCls}>
              <option value="false">No (check amounts)</option>
              <option value="true">Yes (send all)</option>
            </select>
          </Field>
        </div>
        <div className="flex items-center gap-3 mb-4">
          <label className="flex items-center gap-2 text-sm text-[#8b949e] cursor-pointer">
            <input type="checkbox" checked={sendUseWitnessData} onChange={(e) => setSendUseWitnessData(e.target.checked)} className="rounded" />
            Include witnessData
          </label>
          {sendUseWitnessData && (
            <Field label="amountSat">
              <input type="number" value={sendWitnessAmountSat} onChange={(e) => setSendWitnessAmountSat(e.target.value)} className={inputCls} min="546" style={{ width: 100 }} />
            </Field>
          )}
        </div>
        <StepFlow
          steps={[
            { label: '1. Begin (get PSBT)', onClick: handleSendBegin },
            { label: '2. Sign PSBT', variant: 'warning', onClick: handleSignSend },
            { label: '3. Broadcast', variant: 'accent', onClick: handleSendEnd },
          ]}
          auto={{ label: 'Send (auto)', onClick: handleSendAuto }}
          disabled={!active}
        />
        <OutputBox value={sendOut} />
      </Section>

      {/* 7. Batch Send (WalletManager only) */}
      <Section title="7. Batch Send RGB Assets (WalletManager only)" hint="sendBeginBatch / sendBatch — send to multiple recipients in one transaction.">
        {!isManager && active && (
          <p className="text-[#d29922] text-sm mb-4">Batch send requires a WalletManager wallet. Switch to one in the header.</p>
        )}
        <Field label="Recipient map (JSON)">
          <textarea value={batchRecipientMap} onChange={(e) => setBatchRecipientMap(e.target.value)} className={textareaCls} rows={5}
            placeholder={'{\n  "rgb:...assetId": [\n    { "invoice": "rgb:...", "amount": 100 }\n  ]\n}'} />
        </Field>
        <div className="flex gap-4 mb-4 flex-wrap">
          <Field label="Fee rate (sat/vB)">
            <input type="number" value={batchFeeRate} onChange={(e) => setBatchFeeRate(e.target.value)} className={inputCls} step="0.1" />
          </Field>
          <Field label="Donation mode">
            <select value={batchDonation} onChange={(e) => setBatchDonation(e.target.value)} className={selectCls}>
              <option value="false">No</option>
              <option value="true">Yes</option>
            </select>
          </Field>
        </div>
        <StepFlow
          steps={[
            { label: '1. Begin (get PSBT)', onClick: handleBatchBegin },
            { label: '2. Sign PSBT', variant: 'warning', onClick: handleBatchSign },
            { label: '3. Broadcast', variant: 'accent', onClick: handleBatchEnd },
          ]}
          auto={{ label: 'Batch Send (auto)', onClick: handleBatchAuto }}
          disabled={!isManager}
        />
        <OutputBox value={batchOut} />
      </Section>

      {/* 8. Inflate IFA */}
      <Section title="8. Inflate IFA Asset" hint="inflateBegin / inflateEnd / inflate — mint additional supply on an IFA asset.">
        <div className="flex gap-4 mb-4 flex-wrap">
          <Field label="Asset ID (IFA)">
            <input value={inflateAssetId} onChange={(e) => setInflateAssetId(e.target.value)} className={inputCls} placeholder="rgb:..." />
          </Field>
          <Field label="Amounts (comma-separated)">
            <input value={inflateAmounts} onChange={(e) => setInflateAmounts(e.target.value)} className={inputCls} placeholder="100,200" />
          </Field>
        </div>
        <StepFlow
          steps={[
            { label: '1. Begin (get PSBT)', onClick: handleInflateBegin },
            { label: '2. Sign PSBT', variant: 'warning', onClick: handleInflateSign },
            { label: '3. Broadcast', variant: 'accent', onClick: handleInflateEnd },
          ]}
          auto={{ label: 'Inflate (auto)', onClick: handleInflateAuto }}
          disabled={!active}
        />
        <OutputBox value={inflateOut} />
      </Section>

      {/* 9. Transactions & Transfers */}
      <Section title="9. Transactions & Transfers" hint="listTransactions, listTransfers(assetId?), failTransfers()">
        <div className="flex gap-4 mb-4 flex-wrap items-end">
          <Field label="Asset ID (for listTransfers, optional)">
            <input value={txAssetId} onChange={(e) => setTxAssetId(e.target.value)} className={inputCls} placeholder="rgb:..." />
          </Field>
          <Field label="Batch transfer idx (for failTransfers, optional)">
            <input type="number" value={failBatchIdx} onChange={(e) => setFailBatchIdx(e.target.value)} className={inputCls} placeholder="e.g. 0" min="0" />
          </Field>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Btn onClick={handleListTransactions} disabled={!active}>List Transactions</Btn>
          <Btn variant="secondary" onClick={handleListTransfers} disabled={!active}>List Transfers</Btn>
          <Btn variant="danger" onClick={handleFailTransfers} disabled={!active}>Fail Transfers</Btn>
        </div>
        <OutputBox value={txOut} />
      </Section>

      {/* 10. Sign / Verify */}
      <Section title="10. Sign / Verify Message" hint="signMessage, verifyMessage">
        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="Message to sign">
            <input value={signMsg} onChange={(e) => setSignMsg(e.target.value)} className={inputCls} placeholder="Hello, RGB!" />
          </Field>
          <Btn onClick={handleSignMessage} disabled={!active} className="mt-5">Sign Message</Btn>
        </div>
        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="Message to verify">
            <input value={verifyMsg} onChange={(e) => setVerifyMsg(e.target.value)} className={inputCls} placeholder="Hello, RGB!" />
          </Field>
          <Field label="Signature (hex/base64)">
            <input value={verifySig} onChange={(e) => setVerifySig(e.target.value)} className={inputCls} placeholder="sig..." />
          </Field>
        </div>
        <div className="flex gap-4 mb-4 flex-wrap items-end">
          <Field label="Account xpub (optional, defaults to wallet xpub)">
            <input value={verifyXpub} onChange={(e) => setVerifyXpub(e.target.value)} className={inputCls} placeholder="xpub..." />
          </Field>
          <Btn variant="secondary" onClick={handleVerifyMessage} disabled={!active} className="mb-4">Verify Message</Btn>
        </div>
        <OutputBox value={signOut} />
      </Section>
    </div>
  );
}
