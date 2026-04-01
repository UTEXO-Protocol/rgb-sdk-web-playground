import React, { useState } from 'react';
import type { UTEXOWallet } from '@utexo/rgb-sdk-web';
import { useStore } from '../store';
import { Section } from './Section';
import { Field, inputCls, selectCls } from './Field';
import { Btn } from './Btn';
import { OutputBox } from './OutputBox';
import { StepFlow } from './StepFlow';
import { json, getIndexerUrl, proxyIndexerUrl } from '../lib/utils';

interface Props {
  utexo: UTEXOWallet;
  walletId: string;
  network: string;
}

export function UtexoOps({ utexo, walletId, network }: Props) {
  const addLog = useStore((s) => s.addLog);
  const updateWallet = useStore((s) => s.updateWallet);

  const [indexerUrl, setIndexerUrl] = useState(() => getIndexerUrl(network));
  const [onlineOut, setOnlineOut] = useState('');
  const [infoOut, setInfoOut] = useState('');
  const [syncOut, setSyncOut] = useState('');

  // Create UTXOs
  const [utxoNum, setUtxoNum] = useState('');
  const [utxoFee, setUtxoFee] = useState('');
  const [pendingPsbt, setPendingPsbt] = useState<string | null>(null);
  const [signedPsbt, setSignedPsbt] = useState<string | null>(null);
  const [utxosOut, setUtxosOut] = useState('');

  // Key derivation
  const [pubKeysOut, setPubKeysOut] = useState('');
  const [deriveNetwork, setDeriveNetwork] = useState('testnet');

  // Onchain bridge
  const [onchainAssetId, setOnchainAssetId] = useState('');
  const [onchainAmount, setOnchainAmount] = useState('');
  const [onchainInvoice, setOnchainInvoice] = useState('');
  const [onchainSendAssetId, setOnchainSendAssetId] = useState('');
  const [onchainSendAmount, setOnchainSendAmount] = useState('');
  const [onchainOut, setOnchainOut] = useState('');
  const [onchainPendingPsbt, setOnchainPendingPsbt] = useState<string | null>(null);
  const [onchainSignedPsbt, setOnchainSignedPsbt] = useState<string | null>(null);

  // Lightning
  const [lnAssetId, setLnAssetId] = useState('');
  const [lnAmount, setLnAmount] = useState('');
  const [lnInvoice, setLnInvoice] = useState('');
  const [lnSendAssetId, setLnSendAssetId] = useState('');
  const [lnSendAmount, setLnSendAmount] = useState('');
  const [lnOut, setLnOut] = useState('');
  const [lnPendingPsbt, setLnPendingPsbt] = useState<string | null>(null);
  const [lnSignedPsbt, setLnSignedPsbt] = useState<string | null>(null);

  // Validate balance
  const [validateAssetId, setValidateAssetId] = useState('');
  const [validateAmount, setValidateAmount] = useState('');
  const [validateOut, setValidateOut] = useState('');

  // ── goOnline ──────────────────────────────────────────────────────────────────

  async function handleGoOnline() {
    try {
      addLog('Going online...', 'info');
      await utexo.goOnline(proxyIndexerUrl(indexerUrl));
      updateWallet(walletId, { online: true });
      setOnlineOut('Online — connected to ' + indexerUrl);
      addLog('UTEXOWallet online', 'ok');
    } catch (e) {
      setOnlineOut('Error: ' + e);
      addLog('Go online failed: ' + e, 'err');
    }
  }

  // ── Wallet Info ───────────────────────────────────────────────────────────────

  async function handleGetAddress() {
    try {
      const addr = await utexo.getAddress();
      setInfoOut('Address: ' + addr);
      addLog('Address: ' + addr, 'ok');
    } catch (e) { setInfoOut('Error: ' + e); }
  }

  async function handleGetBalance() {
    try {
      const bal = await utexo.getBtcBalance();
      setInfoOut(json(bal));
      addLog('BTC balance retrieved', 'ok');
    } catch (e) { setInfoOut('Error: ' + e); }
  }

  async function handleListAssets() {
    try {
      const assets = await utexo.listAssets();
      setInfoOut(json(assets));
      addLog('Assets listed', 'ok');
    } catch (e) { setInfoOut('Error: ' + e); }
  }

  async function handleListUnspents() {
    try {
      const u = await utexo.listUnspents();
      setInfoOut(json(u));
      addLog('Unspents: ' + (u?.length ?? 0), 'ok');
    } catch (e) { setInfoOut('Error: ' + e); }
  }

  // ── Sync ──────────────────────────────────────────────────────────────────────

  async function handleSync() {
    try {
      addLog('Syncing...', 'info');
      await utexo.syncWallet();
      setSyncOut('Wallet synced');
      addLog('Synced', 'ok');
    } catch (e) { setSyncOut('Error: ' + e); addLog('Sync failed: ' + e, 'err'); }
  }

  async function handleRefresh() {
    try {
      addLog('Refreshing transfers...', 'info');
      await utexo.refreshWallet();
      setSyncOut('Wallet refreshed');
      addLog('Transfers refreshed', 'ok');
    } catch (e) { setSyncOut('Error: ' + e); addLog('Refresh failed: ' + e, 'err'); }
  }

  // ── Create UTXOs ──────────────────────────────────────────────────────────────

  function utxoParams() {
    return {
      upTo: true,
      num: utxoNum ? parseInt(utxoNum) : undefined,
      size: undefined as number | undefined,
      feeRate: utxoFee ? parseFloat(utxoFee) : undefined,
    };
  }

  async function handleUtxosBegin() {
    addLog('Create UTXOs begin...', 'info');
    const psbt = await utexo.createUtxosBegin(utxoParams());
    setPendingPsbt(psbt as string);
    setSignedPsbt(null);
    setUtxosOut('Step 1 — Unsigned PSBT:\n' + psbt);
    addLog('PSBT ready', 'ok');
  }

  async function handleSign() {
    if (!pendingPsbt) { setUtxosOut('Run Step 1 first'); return; }
    addLog('Signing PSBT...', 'info');
    const signed = await utexo.signPsbt(pendingPsbt);
    setSignedPsbt(signed);
    setUtxosOut('Step 2 — Signed PSBT:\n' + signed);
    addLog('PSBT signed', 'ok');
  }

  async function handleUtxosEnd() {
    if (!signedPsbt) { setUtxosOut('Sign PSBT first'); return; }
    addLog('Broadcast...', 'info');
    const result = await utexo.createUtxosEnd({ signedPsbt });
    setPendingPsbt(null); setSignedPsbt(null);
    setUtxosOut('UTXOs created: ' + json(result));
    addLog('UTXOs created', 'ok');
  }

  async function handleUtxosAuto() {
    addLog('Create UTXOs (auto)...', 'info');
    const result = await utexo.createUtxos(utxoParams());
    setUtxosOut('UTXOs created: ' + json(result));
    addLog('UTXOs created (auto)', 'ok');
  }

  // ── Key Derivation ────────────────────────────────────────────────────────────

  async function handleGetPubKeys() {
    try {
      addLog('Getting public keys...', 'info');
      const result = await utexo.getPubKeys();
      setPubKeysOut(json(result));
      addLog('Public keys retrieved', 'ok');
    } catch (e) { setPubKeysOut('Error: ' + e); }
  }

  async function handleDerivePublicKeys() {
    try {
      addLog('Deriving public keys for ' + deriveNetwork + '...', 'info');
      const result = await utexo.derivePublicKeys(deriveNetwork as any);
      setPubKeysOut(json(result));
      addLog('Keys derived', 'ok');
    } catch (e) { setPubKeysOut('Error: ' + e); }
  }

  // ── Onchain Bridge ────────────────────────────────────────────────────────────

  async function handleOnchainReceive() {
    if (!onchainAmount) { setOnchainOut('Enter amount'); return; }
    try {
      addLog('onchainReceive...', 'info');
      const result = await utexo.onchainReceive({ assetId: onchainAssetId.trim() || '', amount: parseInt(onchainAmount) });
      setOnchainOut(json(result));
      if (result?.invoice) setOnchainInvoice(result.invoice as string);
      addLog('Onchain receive invoice created', 'ok');
    } catch (e) { setOnchainOut('Error: ' + e); addLog('onchainReceive failed: ' + e, 'err'); }
  }

  async function handleOnchainSendBegin() {
    if (!onchainInvoice.trim()) { setOnchainOut('Enter invoice'); return; }
    try {
      addLog('onchainSendBegin...', 'info');
      const psbt = await utexo.onchainSendBegin({ invoice: onchainInvoice.trim(), assetId: onchainSendAssetId.trim() || undefined, amount: onchainSendAmount ? parseInt(onchainSendAmount) : undefined });
      setOnchainPendingPsbt(psbt);
      setOnchainSignedPsbt(null);
      setOnchainOut('Step 1 — Unsigned PSBT:\n' + psbt);
      addLog('Onchain send PSBT ready', 'ok');
    } catch (e) { setOnchainOut('Error: ' + e); addLog('onchainSendBegin failed: ' + e, 'err'); }
  }

  async function handleOnchainSignSend() {
    if (!onchainPendingPsbt) { setOnchainOut('Run Step 1 first'); return; }
    addLog('Signing onchain PSBT...', 'info');
    const signed = await utexo.signPsbt(onchainPendingPsbt);
    setOnchainSignedPsbt(signed);
    setOnchainOut('Step 2 — Signed PSBT:\n' + signed);
    addLog('Onchain PSBT signed', 'ok');
  }

  async function handleOnchainSendEnd() {
    if (!onchainSignedPsbt) { setOnchainOut('Sign PSBT first'); return; }
    addLog('onchainSendEnd...', 'info');
    const result = await utexo.onchainSendEnd({ signedPsbt: onchainSignedPsbt, invoice: onchainInvoice.trim() });
    setOnchainPendingPsbt(null); setOnchainSignedPsbt(null);
    setOnchainOut('Result:\n' + json(result));
    addLog('Onchain send complete', 'ok');
  }

  async function handleOnchainSendAuto() {
    if (!onchainInvoice.trim()) { setOnchainOut('Enter invoice'); return; }
    addLog('onchainSend (auto)...', 'info');
    try {
      const result = await utexo.onchainSend({ invoice: onchainInvoice.trim(), assetId: onchainSendAssetId.trim() || undefined, amount: onchainSendAmount ? parseInt(onchainSendAmount) : undefined });
      setOnchainOut('Result (auto):\n' + json(result));
      addLog('Onchain send complete (auto)', 'ok');
    } catch (e) { setOnchainOut('Error: ' + e); addLog('onchainSend failed: ' + e, 'err'); }
  }

  async function handleGetOnchainSendStatus() {
    if (!onchainInvoice.trim()) { setOnchainOut('Enter invoice'); return; }
    try {
      const result = await utexo.getOnchainSendStatus(onchainInvoice.trim());
      setOnchainOut('Status: ' + json(result));
    } catch (e) { setOnchainOut('Error: ' + e); }
  }

  async function handleListOnchainTransfers() {
    try {
      const result = await utexo.listOnchainTransfers(onchainAssetId.trim() || undefined);
      setOnchainOut(json(result));
      addLog('Onchain transfers: ' + (result?.length ?? 0), 'ok');
    } catch (e) { setOnchainOut('Error: ' + e); }
  }

  // ── Lightning ─────────────────────────────────────────────────────────────────

  async function handleCreateLightningInvoice() {
    if (!lnAssetId.trim() || !lnAmount) { setLnOut('Enter asset ID and amount'); return; }
    try {
      addLog('Creating lightning invoice...', 'info');
      const result = await utexo.createLightningInvoice({ asset: { assetId: lnAssetId.trim(), amount: parseInt(lnAmount) } });
      setLnOut(json(result));
      if (result?.lnInvoice) setLnInvoice(result.lnInvoice);
      addLog('Lightning invoice created', 'ok');
    } catch (e) { setLnOut('Error: ' + e); addLog('createLightningInvoice failed: ' + e, 'err'); }
  }

  async function handlePayLnBegin() {
    if (!lnInvoice.trim()) { setLnOut('Enter LN invoice'); return; }
    try {
      addLog('payLightningInvoiceBegin...', 'info');
      const psbt = await utexo.payLightningInvoiceBegin({ lnInvoice: lnInvoice.trim(), assetId: lnSendAssetId.trim() || undefined, amount: lnSendAmount ? parseInt(lnSendAmount) : undefined });
      setLnPendingPsbt(psbt);
      setLnSignedPsbt(null);
      setLnOut('Step 1 — Unsigned PSBT:\n' + psbt);
      addLog('LN pay PSBT ready', 'ok');
    } catch (e) { setLnOut('Error: ' + e); addLog('payLightningInvoiceBegin failed: ' + e, 'err'); }
  }

  async function handlePayLnSign() {
    if (!lnPendingPsbt) { setLnOut('Run Step 1 first'); return; }
    addLog('Signing LN PSBT...', 'info');
    const signed = await utexo.signPsbt(lnPendingPsbt);
    setLnSignedPsbt(signed);
    setLnOut('Step 2 — Signed PSBT:\n' + signed);
    addLog('LN PSBT signed', 'ok');
  }

  async function handlePayLnEnd() {
    if (!lnSignedPsbt) { setLnOut('Sign PSBT first'); return; }
    addLog('payLightningInvoiceEnd...', 'info');
    const result = await utexo.payLightningInvoiceEnd({ signedPsbt: lnSignedPsbt, lnInvoice: lnInvoice.trim() });
    setLnPendingPsbt(null); setLnSignedPsbt(null);
    setLnOut('Result:\n' + json(result));
    addLog('LN pay complete', 'ok');
  }

  async function handlePayLnAuto() {
    if (!lnInvoice.trim()) { setLnOut('Enter LN invoice'); return; }
    addLog('payLightningInvoice (auto)...', 'info');
    try {
      const result = await utexo.payLightningInvoice({ lnInvoice: lnInvoice.trim(), assetId: lnSendAssetId.trim() || undefined, amount: lnSendAmount ? parseInt(lnSendAmount) : undefined });
      setLnOut('Result (auto):\n' + json(result));
      addLog('LN pay complete (auto)', 'ok');
    } catch (e) { setLnOut('Error: ' + e); addLog('payLightningInvoice failed: ' + e, 'err'); }
  }

  async function handleGetLnSendRequest() {
    if (!lnInvoice.trim()) { setLnOut('Enter LN invoice'); return; }
    try {
      const result = await utexo.getLightningSendRequest(lnInvoice.trim());
      setLnOut('Status: ' + json(result));
    } catch (e) { setLnOut('Error: ' + e); }
  }

  async function handleGetLnReceiveRequest() {
    if (!lnInvoice.trim()) { setLnOut('Enter LN invoice'); return; }
    try {
      const result = await utexo.getLightningReceiveRequest(lnInvoice.trim());
      setLnOut('Status: ' + json(result));
    } catch (e) { setLnOut('Error: ' + e); }
  }

  // ── Validate Balance ──────────────────────────────────────────────────────────

  async function handleValidateBalance() {
    if (!validateAssetId.trim() || !validateAmount) { setValidateOut('Enter asset ID and amount'); return; }
    try {
      addLog('Validating balance...', 'info');
      await utexo.validateBalance(validateAssetId.trim(), parseInt(validateAmount));
      setValidateOut('Balance valid — spendable >= ' + validateAmount);
      addLog('Balance valid', 'ok');
    } catch (e) {
      setValidateOut('Validation failed: ' + e);
      addLog('validateBalance failed: ' + e, 'err');
    }
  }

  return (
    <>
      {/* Go Online */}
      <Section title="Go Online" hint="Connect to an Esplora indexer. Note: UTEXOWallet.goOnline() may not be fully implemented.">
        <Field label="Indexer URL">
          <input value={indexerUrl} onChange={(e) => setIndexerUrl(e.target.value)} className={inputCls} />
        </Field>
        <Btn variant="accent" onClick={handleGoOnline}>Go Online</Btn>
        <OutputBox value={onlineOut} />
      </Section>

      {/* Wallet Info */}
      <Section title="Wallet Info">
        <div className="flex gap-2 flex-wrap mb-2">
          <Btn onClick={handleGetAddress}>Get Address</Btn>
          <Btn onClick={handleGetBalance}>BTC Balance</Btn>
          <Btn onClick={handleListAssets}>List Assets</Btn>
          <Btn variant="secondary" onClick={handleListUnspents}>List Unspents</Btn>
        </div>
        <OutputBox value={infoOut} />
      </Section>

      {/* Sync */}
      <Section title="Sync">
        <div className="flex gap-2 flex-wrap">
          <Btn onClick={handleSync}>Sync Wallet</Btn>
          <Btn variant="secondary" onClick={handleRefresh}>Refresh Transfers</Btn>
        </div>
        <OutputBox value={syncOut} />
      </Section>

      {/* Create UTXOs */}
      <Section title="Create UTXOs" hint="Allocate colored UTXOs for RGB transfers.">
        <div className="flex gap-4 mb-4 flex-wrap">
          <Field label="Number (optional)">
            <input type="number" value={utxoNum} onChange={(e) => setUtxoNum(e.target.value)} className={inputCls} placeholder="e.g. 1" min="1" />
          </Field>
          <Field label="Fee rate (optional)">
            <input type="number" value={utxoFee} onChange={(e) => setUtxoFee(e.target.value)} className={inputCls} placeholder="e.g. 1.5" step="0.1" />
          </Field>
        </div>
        <StepFlow
          steps={[
            { label: '1. Begin (get PSBT)', onClick: handleUtxosBegin },
            { label: '2. Sign PSBT', variant: 'warning', onClick: handleSign },
            { label: '3. Broadcast', variant: 'accent', onClick: handleUtxosEnd },
          ]}
          auto={{ label: 'Create UTXOs (auto)', onClick: handleUtxosAuto }}
        />
        <OutputBox value={utxosOut} />
      </Section>

      {/* Key Derivation */}
      <Section title="Key Derivation" hint="getPubKeys() returns layer1 xpubs. derivePublicKeys(network) derives keys for a specific network.">
        <div className="flex gap-4 items-end flex-wrap">
          <Field label="Network (for derivePublicKeys)">
            <select value={deriveNetwork} onChange={(e) => setDeriveNetwork(e.target.value)} className={selectCls}>
              <option value="testnet">testnet</option>
              <option value="mainnet">mainnet</option>
              <option value="regtest">regtest</option>
            </select>
          </Field>
          <Btn onClick={handleGetPubKeys} className="mb-4">getPubKeys()</Btn>
          <Btn variant="secondary" onClick={handleDerivePublicKeys} className="mb-4">derivePublicKeys(network)</Btn>
        </div>
        <OutputBox value={pubKeysOut} />
      </Section>

      {/* Onchain Bridge */}
      <Section title="Onchain Bridge Protocol" hint="Cross-network RGB transfers via the UTEXO bridge.">
        <p className="text-[#8b949e] text-xs mb-3">onchainReceive — create an invoice to receive assets from mainnet RGB into UTEXO</p>
        <div className="flex gap-4 mb-4 flex-wrap">
          <Field label="Asset ID (optional)">
            <input value={onchainAssetId} onChange={(e) => setOnchainAssetId(e.target.value)} className={inputCls} placeholder="rgb:..." />
          </Field>
          <Field label="Amount">
            <input type="number" value={onchainAmount} onChange={(e) => setOnchainAmount(e.target.value)} className={inputCls} placeholder="100" min="1" />
          </Field>
          <Btn onClick={handleOnchainReceive} className="mb-4">onchainReceive</Btn>
        </div>
        <p className="text-[#8b949e] text-xs mb-3 mt-2">onchainSend — send from UTEXO to a mainnet RGB invoice</p>
        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="Invoice (mainnet RGB or bridge)">
            <input value={onchainInvoice} onChange={(e) => setOnchainInvoice(e.target.value)} className={inputCls} placeholder="rgb:..." />
          </Field>
          <Field label="Asset ID (optional override)">
            <input value={onchainSendAssetId} onChange={(e) => setOnchainSendAssetId(e.target.value)} className={inputCls} placeholder="rgb:..." />
          </Field>
          <Field label="Amount (optional override)">
            <input type="number" value={onchainSendAmount} onChange={(e) => setOnchainSendAmount(e.target.value)} className={inputCls} placeholder="100" min="1" />
          </Field>
        </div>
        <div className="flex gap-2 mb-4 flex-wrap">
          <Btn variant="secondary" onClick={handleGetOnchainSendStatus}>Get Send Status</Btn>
          <Btn variant="secondary" onClick={handleListOnchainTransfers}>List Onchain Transfers</Btn>
        </div>
        <StepFlow
          steps={[
            { label: '1. Begin (get PSBT)', onClick: handleOnchainSendBegin },
            { label: '2. Sign PSBT', variant: 'warning', onClick: handleOnchainSignSend },
            { label: '3. Broadcast', variant: 'accent', onClick: handleOnchainSendEnd },
          ]}
          auto={{ label: 'onchainSend (auto)', onClick: handleOnchainSendAuto }}
        />
        <OutputBox value={onchainOut} />
      </Section>

      {/* Lightning */}
      <Section title="Lightning Protocol" hint="createLightningInvoice — generate a Lightning receive invoice. payLightningInvoice — pay via UTEXO bridge.">
        <p className="text-[#8b949e] text-xs mb-3">createLightningInvoice — create a receive invoice</p>
        <div className="flex gap-4 mb-4 flex-wrap">
          <Field label="Asset ID">
            <input value={lnAssetId} onChange={(e) => setLnAssetId(e.target.value)} className={inputCls} placeholder="rgb:..." />
          </Field>
          <Field label="Amount">
            <input type="number" value={lnAmount} onChange={(e) => setLnAmount(e.target.value)} className={inputCls} placeholder="100" min="1" />
          </Field>
          <Btn onClick={handleCreateLightningInvoice} className="mb-4">Create LN Invoice</Btn>
        </div>
        <p className="text-[#8b949e] text-xs mb-3 mt-2">payLightningInvoice — pay a LN invoice via UTEXO bridge</p>
        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="LN invoice">
            <input value={lnInvoice} onChange={(e) => setLnInvoice(e.target.value)} className={inputCls} placeholder="lnbc1..." />
          </Field>
          <Field label="Asset ID (optional)">
            <input value={lnSendAssetId} onChange={(e) => setLnSendAssetId(e.target.value)} className={inputCls} placeholder="rgb:..." />
          </Field>
          <Field label="Amount (optional)">
            <input type="number" value={lnSendAmount} onChange={(e) => setLnSendAmount(e.target.value)} className={inputCls} placeholder="100" min="1" />
          </Field>
        </div>
        <div className="flex gap-2 mb-4 flex-wrap">
          <Btn variant="secondary" onClick={handleGetLnSendRequest}>Get LN Send Status</Btn>
          <Btn variant="secondary" onClick={handleGetLnReceiveRequest}>Get LN Receive Status</Btn>
        </div>
        <StepFlow
          steps={[
            { label: '1. Begin (get PSBT)', onClick: handlePayLnBegin },
            { label: '2. Sign PSBT', variant: 'warning', onClick: handlePayLnSign },
            { label: '3. Broadcast', variant: 'accent', onClick: handlePayLnEnd },
          ]}
          auto={{ label: 'Pay LN Invoice (auto)', onClick: handlePayLnAuto }}
        />
        <OutputBox value={lnOut} />
      </Section>

      {/* Validate Balance */}
      <Section title="Validate Balance" hint="validateBalance(assetId, amount) — throws if spendable balance < amount.">
        <div className="flex gap-4 items-end flex-wrap">
          <Field label="Asset ID">
            <input value={validateAssetId} onChange={(e) => setValidateAssetId(e.target.value)} className={inputCls} placeholder="rgb:..." />
          </Field>
          <Field label="Amount">
            <input type="number" value={validateAmount} onChange={(e) => setValidateAmount(e.target.value)} className={inputCls} placeholder="100" min="1" />
          </Field>
          <Btn onClick={handleValidateBalance} className="mb-4">Validate Balance</Btn>
        </div>
        <OutputBox value={validateOut} />
      </Section>
    </>
  );
}
