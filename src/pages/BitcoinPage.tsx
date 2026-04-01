import React, { useState } from 'react';
import { useStore } from '../store';
import { Section } from '../components/Section';
import { Field, inputCls, textareaCls } from '../components/Field';
import { Btn } from '../components/Btn';
import { OutputBox } from '../components/OutputBox';
import { StepFlow } from '../components/StepFlow';
import { useActiveWallet } from '../hooks/useActiveWallet';
import { json, FAUCET_BASE_URL, FAUCET_TOKEN, mineBlocks, fundAddress } from '../lib/utils';

export function BitcoinPage() {
  const addLog = useStore((s) => s.addLog);
  const activeWallet = useActiveWallet();
  const wallet = activeWallet?.instance ?? null;

  const [faucetUrl, setFaucetUrl] = useState(FAUCET_BASE_URL);
  const [faucetToken, setFaucetToken] = useState(FAUCET_TOKEN);
  const [fundAmount, setFundAmount] = useState('10000');
  const [fundFeeRate, setFundFeeRate] = useState('5');

  const [sendAddress, setSendAddress] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendFeeRate, setSendFeeRate] = useState('2');
  const [psbtInput, setPsbtInput] = useState('');

  const [feeBlocks, setFeeBlocks] = useState('6');
  const [mineCount, setMineCount] = useState('1');
  const [mineOut, setMineOut] = useState('');

  const [addrOut, setAddrOut] = useState('');
  const [fundOut, setFundOut] = useState('');
  const [sendOut, setSendOut] = useState('');
  const [signOut, setSignOut] = useState('');
  const [feeOut, setFeeOut] = useState('');
  const [psbtFeeOut, setPsbtFeeOut] = useState('');

  const [pendingPsbt, setPendingPsbt] = useState<string | null>(null);
  const [signedPsbt, setSignedPsbt] = useState<string | null>(null);

  const activeNetwork = (() => {
    try { return activeWallet?.instance.getNetwork() ?? null; } catch { return null; }
  })();
  const isRegtest = activeNetwork === 'regtest';
  const active = !!wallet;

  async function handleMine() {
    const n = parseInt(mineCount) || 1;
    try {
      addLog('Mining ' + n + ' block(s)...', 'info');
      const result = await mineBlocks(n);
      setMineOut('Mined ' + n + ' block(s)\n' + json(result));
      addLog('Mined ' + n + ' block(s)', 'ok');
    } catch (e) {
      setMineOut('Error: ' + e + '\n\nAlternatively run: ./regtest.sh mine ' + n);
      addLog('Mine failed: ' + e, 'err');
    }
  }

  async function handleGetAddress() {
    if (!wallet) { setAddrOut('Create a wallet first (Wallet page)'); return; }
    try {
      addLog('Getting address...', 'info');
      const addr = await wallet.getAddress();
      setAddrOut('Address: ' + addr);
      setSendAddress(addr);
      addLog('Address: ' + addr, 'ok');
    } catch (e) {
      setAddrOut('Error: ' + e);
      addLog('Get address failed: ' + e, 'err');
    }
  }

  async function handleGetBalance() {
    if (!wallet) { setAddrOut('Create a wallet first'); return; }
    try {
      addLog('Getting BTC balance...', 'info');
      const bal = await wallet.getBtcBalance();
      setAddrOut(json(bal));
      addLog('BTC balance retrieved', 'ok');
    } catch (e) { setAddrOut('Error: ' + e); }
  }

  async function handleListUnspents() {
    if (!wallet) { setAddrOut('Create a wallet first'); return; }
    try {
      addLog('Listing unspents...', 'info');
      const result = await wallet.listUnspents();
      setAddrOut(json(result));
      addLog('Unspents: ' + (result?.length ?? 0), 'ok');
    } catch (e) { setAddrOut('Error: ' + e); }
  }

  async function handleFundFaucet() {
    if (!wallet) { setFundOut('Create a wallet first'); return; }
    try {
      addLog('Getting address for faucet...', 'info');
      const addr = await wallet.getAddress();
      const amount = parseInt(fundAmount) || 10000;
      const feeRate = parseInt(fundFeeRate) || 5;
      addLog('Funding ' + addr + ' with ' + amount + ' sats via faucet...', 'info');
      const resp = await fetch(faucetUrl + '/sendbtc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + faucetToken },
        body: JSON.stringify({ address: addr, amount, fee_rate: feeRate, skip_sync: false }),
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status + ': ' + await resp.text());
      const result = await resp.json();
      setFundOut('Funded!\n' + json(result));
      setSendAddress(addr);
      addLog('Faucet funded: ' + amount + ' sats', 'ok');
    } catch (e) {
      setFundOut('Error: ' + e);
      addLog('Faucet failed: ' + e, 'err');
    }
  }

  async function handleFundRegtest() {
    if (!wallet) { setFundOut('Create a wallet first'); return; }
    try {
      const addr = await wallet.getAddress();
      const amount = parseInt(fundAmount) || 10000;
      addLog('sendtoaddress ' + addr + ' ' + amount + ' sats...', 'info');
      const txid = await fundAddress(addr, amount);
      addLog('Funded txid: ' + txid + ' — mining 1 block to confirm...', 'info');
      await mineBlocks(1);
      setFundOut('Funded + confirmed!\ntxid: ' + txid + '\n\nMined 1 block to confirm.');
      addLog('Regtest funded: ' + amount + ' sats, 1 block mined', 'ok');
    } catch (e) {
      setFundOut('Error: ' + e);
      addLog('Regtest fund failed: ' + e, 'err');
    }
  }

  async function handleSendBegin() {
    if (!wallet) { setSendOut('Create a wallet first'); return; }
    if (!sendAddress || !sendAmount) { setSendOut('Enter address and amount'); return; }
    addLog('Send BTC begin...', 'info');
    const psbt = await wallet.sendBtcBegin({
      address: sendAddress,
      amount: parseInt(sendAmount),
      feeRate: parseFloat(sendFeeRate) || 2,
    });
    setPendingPsbt(psbt);
    setSignedPsbt(null);
    setPsbtInput(psbt);
    setSendOut('Step 1 — Unsigned PSBT:\n' + psbt);
    addLog('Send begin — unsigned PSBT ready', 'ok');
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
    addLog('Broadcasting...', 'info');
    const result = await wallet.sendBtcEnd({ signedPsbt });
    setPendingPsbt(null);
    setSignedPsbt(null);
    setSendOut('Step 3 — Broadcast result:\n' + json(result));
    addLog('BTC sent: ' + json(result), 'ok');
  }

  async function handleSendAuto() {
    if (!wallet) { setSendOut('Create a wallet first'); return; }
    if (!sendAddress || !sendAmount) { setSendOut('Enter address and amount'); return; }
    addLog('Send BTC (auto)...', 'info');
    const result = await wallet.sendBtc({
      address: sendAddress,
      amount: parseInt(sendAmount),
      feeRate: parseFloat(sendFeeRate) || 2,
    });
    setSendOut('Result (auto):\n' + json(result));
    addLog('BTC sent (auto)', 'ok');
  }

  async function handleSignArbitrary() {
    if (!wallet) { setSignOut('Create a wallet first'); return; }
    if (!psbtInput.trim()) { setSignOut('Paste a PSBT first'); return; }
    try {
      addLog('Signing PSBT...', 'info');
      const signed = await wallet.signPsbt(psbtInput.trim());
      setSignOut(signed);
      addLog('PSBT signed', 'ok');
    } catch (e) {
      setSignOut('Error: ' + e);
      addLog('Sign failed: ' + e, 'err');
    }
  }

  async function handleEstimateFeeFromPsbt() {
    if (!wallet) { setPsbtFeeOut('Create a wallet first'); return; }
    if (!psbtInput.trim()) { setPsbtFeeOut('Paste a PSBT first'); return; }
    try {
      addLog('Estimating fee from PSBT...', 'info');
      const result = await wallet.estimateFee(psbtInput.trim());
      setPsbtFeeOut(json(result));
      addLog('Fee estimated from PSBT', 'ok');
    } catch (e) {
      setPsbtFeeOut('Error: ' + e);
      addLog('estimateFee failed: ' + e, 'err');
    }
  }

  async function handleFeeEstimation() {
    if (!wallet) { setFeeOut('Create a wallet first'); return; }
    try {
      const blocks = parseInt(feeBlocks) || 6;
      addLog('Estimating fee for ' + blocks + ' blocks...', 'info');
      const result = await wallet.estimateFeeRate(blocks);
      setFeeOut(json(result));
      addLog('Fee estimated', 'ok');
    } catch (e) {
      setFeeOut('Error: ' + e);
      addLog('Fee estimation failed: ' + e, 'err');
    }
  }

  return (
    <div>
      <h1 className="text-[#58a6ff] text-2xl font-bold mb-1">Bitcoin Operations</h1>
      <p className="text-[#8b949e] text-sm mb-6">
        Address, balance, faucet funding, send BTC with explicit PSBT signing, fee estimation
      </p>

      {!active && (
        <div className="bg-[#1c1f26] text-[#d29922] text-sm px-3 py-2 rounded mb-6">
          Create a wallet first (Wallet page).
        </div>
      )}

      {/* 1. Address & Balance */}
      <Section title="1. Address & Balance">
        <div className="flex gap-2 flex-wrap mb-2">
          <Btn onClick={handleGetAddress} disabled={!active}>Get Address</Btn>
          <Btn onClick={handleGetBalance} disabled={!active}>BTC Balance</Btn>
          <Btn variant="secondary" onClick={handleListUnspents} disabled={!active}>List Unspents</Btn>
        </div>
        <OutputBox value={addrOut} />
      </Section>

      {/* 2. Faucet Funding */}
      <Section title="2. Faucet Funding" hint="Fund via the thunderstack.org signet faucet, or the local regtest helper.">
        <Field label="Faucet base URL">
          <input value={faucetUrl} onChange={(e) => setFaucetUrl(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Bearer token">
          <input value={faucetToken} onChange={(e) => setFaucetToken(e.target.value)} className={inputCls} />
        </Field>
        <div className="flex gap-4 mb-4 flex-wrap">
          <Field label="Amount (sats)">
            <input type="number" value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} className={inputCls} min="1000" max="100000" />
          </Field>
          <Field label="Fee rate (sat/vB)">
            <input type="number" value={fundFeeRate} onChange={(e) => setFundFeeRate(e.target.value)} className={inputCls} min="1" />
          </Field>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Btn variant="accent" onClick={handleFundFaucet} disabled={!active}>Fund via Faucet</Btn>
          <Btn variant="secondary" onClick={handleFundRegtest} disabled={!active}>Fund (regtest)</Btn>
        </div>
        <OutputBox value={fundOut} />
      </Section>

      {/* Mine Blocks (regtest only) */}
      {isRegtest && (
        <Section title="Mine Blocks" hint="Calls bitcoind JSON-RPC (getnewaddress + generatetoaddress). Requires port 18443 exposed and -rpccorsdomain set. Fallback: ./regtest.sh mine N">
          <div className="flex gap-4 items-end mb-4">
            <Field label="Blocks">
              <input type="number" value={mineCount} onChange={(e) => setMineCount(e.target.value)} className={inputCls} min="1" max="100" style={{ width: 80 }} />
            </Field>
            <Btn variant="warning" onClick={handleMine} disabled={!active} className="mb-4">Mine</Btn>
          </div>
          <OutputBox value={mineOut} />
        </Section>
      )}

      {/* 3. Send BTC */}
      <Section title="3. Send BTC" hint="Three-step flow showing explicit PSBT signing. Use Send BTC (auto) for one click.">
        <Field label="Destination address">
          <input value={sendAddress} onChange={(e) => setSendAddress(e.target.value)} className={inputCls} placeholder="tb1q... / bcrt1q..." />
        </Field>
        <div className="flex gap-4 mb-4 flex-wrap">
          <Field label="Amount (sats)">
            <input type="number" value={sendAmount} onChange={(e) => setSendAmount(e.target.value)} className={inputCls} placeholder="5000" min="546" />
          </Field>
          <Field label="Fee rate (sat/vB)">
            <input type="number" value={sendFeeRate} onChange={(e) => setSendFeeRate(e.target.value)} className={inputCls} step="0.1" min="1" />
          </Field>
        </div>
        <StepFlow
          steps={[
            { label: '1. Begin (get PSBT)', onClick: handleSendBegin },
            { label: '2. Sign PSBT', variant: 'warning', onClick: handleSignSend },
            { label: '3. Broadcast', variant: 'accent', onClick: handleSendEnd },
          ]}
          auto={{ label: 'Send BTC (auto)', onClick: handleSendAuto }}
          disabled={!active}
        />
        <OutputBox value={sendOut} />
      </Section>

      {/* 4. Sign arbitrary PSBT */}
      <Section title="4. Sign PSBT" hint="Sign any base64 PSBT using the wallet's embedded mnemonic.">
        <Field label="Unsigned PSBT (base64)">
          <textarea value={psbtInput} onChange={(e) => setPsbtInput(e.target.value)} className={textareaCls} rows={4} placeholder="cHNidP8B..." />
        </Field>
        <Btn variant="warning" onClick={handleSignArbitrary} disabled={!active}>Sign PSBT</Btn>
        <OutputBox label="Signed PSBT" value={signOut} />
      </Section>

      {/* 5. Fee Estimation */}
      <Section title="5. Fee Estimation (by blocks)" hint="estimateFeeRate(blocks) — query the indexer for a fee rate estimate.">
        <div className="flex gap-4 items-end mb-4">
          <Field label="Target blocks">
            <input type="number" value={feeBlocks} onChange={(e) => setFeeBlocks(e.target.value)} className={inputCls} min="1" max="144" />
          </Field>
          <Btn onClick={handleFeeEstimation} disabled={!active} className="mb-4">Estimate Fee Rate</Btn>
        </div>
        <OutputBox value={feeOut} />
      </Section>

      {/* 6. Estimate Fee from PSBT */}
      <Section title="6. Estimate Fee from PSBT" hint="estimateFee(psbtBase64) — calculate fee for a specific PSBT by examining inputs/outputs.">
        <Field label="PSBT (base64)">
          <textarea value={psbtInput} onChange={(e) => setPsbtInput(e.target.value)} className={textareaCls} rows={4} placeholder="cHNidP8B..." />
        </Field>
        <Btn onClick={handleEstimateFeeFromPsbt} disabled={!active}>Estimate Fee from PSBT</Btn>
        <OutputBox value={psbtFeeOut} />
      </Section>
    </div>
  );
}
