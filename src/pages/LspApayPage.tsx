import { useState } from 'react';
import type { UTEXOWallet, UtexoLsp, LspPeer } from '@utexo/rgb-sdk-web';
import { useStore } from '../store';
import { Section } from '../components/Section';
import { Field, inputCls } from '../components/Field';
import { Btn } from '../components/Btn';
import { OutputBox } from '../components/OutputBox';
import { useActiveWallet } from '../hooks/useActiveWallet';
import { json } from '../lib/utils';
import { RegtestLspFlow } from '../components/RegtestLspFlow';
import { ApayCartCheckout } from '../components/apay/ApayCartCheckout';
import { RegularChannelFlow } from '../components/apay/RegularChannelFlow';
import { KeysendReproFlow } from '../components/apay/KeysendReproFlow';

export function LspApayPage() {
  const addLog = useStore((s) => s.addLog);
  const activeWallet = useActiveWallet();
  const utexo =
    activeWallet?.type === 'utexo' ? (activeWallet.instance as UTEXOWallet) : null;

  const [lsp, setLsp] = useState<UtexoLsp | null>(null);

  // ── Create / connect ───────────────────────────────────────────────────────
  const [lspBaseUrl, setLspBaseUrl] = useState('');
  const [peerPubkey, setPeerPubkey] = useState('');
  const [peerHost, setPeerHost] = useState('');
  const [peerPort, setPeerPort] = useState('9735');
  const [bearerToken, setBearerToken] = useState('');
  const [connectOut, setConnectOut] = useState('');

  // ── Receive asset ──────────────────────────────────────────────────────────
  const [recvAssetId, setRecvAssetId] = useState('');
  const [recvSats, setRecvSats] = useState('3000');
  const [recvRgb, setRecvRgb] = useState('100');
  const [recvLnInvoice, setRecvLnInvoice] = useState('');
  const [recvOut, setRecvOut] = useState('');

  // ── Send asset ─────────────────────────────────────────────────────────────
  const [sendRgbInvoice, setSendRgbInvoice] = useState('');
  const [sendOut, setSendOut] = useState('');

  // ── Pay address ────────────────────────────────────────────────────────────
  const [payAddress, setPayAddress] = useState('');
  const [payAmtMsat, setPayAmtMsat] = useState('1000');
  const [payAssetId, setPayAssetId] = useState('');
  const [payAssetAmount, setPayAssetAmount] = useState('');
  const [payOut, setPayOut] = useState('');

  // ── APay / Lightning Address ───────────────────────────────────────────────
  const [apayHostNodeId, setApayHostNodeId] = useState('');
  const [apayUsername, setApayUsername] = useState('');
  const [apayDomain, setApayDomain] = useState('');
  const [apayOut, setApayOut] = useState('');

  const warn = !utexo && (
    <p className="text-xs text-[#d29922] mb-3">
      Switch to a UTEXO wallet in the header (created with a transportEndpoint) to use LSP/APay.
    </p>
  );

  function requireLsp(set: (s: string) => void): UtexoLsp | null {
    if (!lsp) {
      set('Create / connect to the LSP first (section 1).');
      return null;
    }
    return lsp;
  }

  // ── 1. Create + connect ────────────────────────────────────────────────────

  async function handleCreateLsp() {
    if (!utexo) return setConnectOut('No UTEXO wallet active');
    try {
      addLog('Creating UtexoLsp...', 'info');
      let instance: UtexoLsp;
      if (peerPubkey.trim() && peerHost.trim()) {
        const peer: LspPeer = {
          baseUrl: lspBaseUrl.trim(),
          peerPubkey: peerPubkey.trim(),
          peerHost: peerHost.trim(),
          peerPort: parseInt(peerPort) || 9735,
          bearerToken: bearerToken.trim() || undefined,
        };
        instance = await utexo.createLsp(peer);
      } else {
        // Auto-discover the peer from the wallet's configured lspBaseUrl via GET /get_info.
        instance = await utexo.createLsp(undefined, parseInt(peerPort) || 9735);
      }
      setLsp(instance);
      setConnectOut('UtexoLsp ready\npeer: ' + json(instance.peer));
      addLog('UtexoLsp created', 'ok');
    } catch (e) {
      setConnectOut('Error: ' + e);
      addLog('createLsp failed: ' + e, 'err');
    }
  }

  async function handleConnect() {
    const l = requireLsp(setConnectOut);
    if (!l) return;
    try {
      addLog('Connecting to LSP peer...', 'info');
      await l.connect();
      const info = await l.http.getInfo();
      setConnectOut('Connected.\nLSP get_info:\n' + json(info));
      addLog('Connected to LSP', 'ok');
    } catch (e) {
      setConnectOut('Error: ' + e);
      addLog('connect failed: ' + e, 'err');
    }
  }

  // ── 2. Receive asset (Lightning → RGB) ─────────────────────────────────────

  async function handleReceiveAsset() {
    const l = requireLsp(setRecvOut);
    if (!l) return;
    if (!recvAssetId.trim()) return setRecvOut('Enter asset ID');
    try {
      addLog('LSP receiveAsset...', 'info');
      const res = await l.receiveAsset({
        assetId: recvAssetId.trim(),
        amountSats: parseInt(recvSats) || 0,
        amountRgb: parseInt(recvRgb) || 0,
      });
      setRecvLnInvoice(res.lnInvoice);
      setRecvOut(json(res));
      addLog('receiveAsset ok — share rgbInvoice with the sender', 'ok');
    } catch (e) {
      setRecvOut('Error: ' + e);
      addLog('receiveAsset failed: ' + e, 'err');
    }
  }

  async function handleAwaitSettlement() {
    const l = requireLsp(setRecvOut);
    if (!l) return;
    if (!recvLnInvoice.trim()) return setRecvOut('No LN invoice — run receiveAsset first');
    try {
      addLog('Awaiting receive settlement...', 'info');
      const outcome = await l.awaitReceiveSettlement(recvLnInvoice.trim(), {
        onProgress: (s) => addLog('settlement: ' + s, 'info'),
      });
      setRecvOut('Settlement outcome: ' + outcome);
      addLog('awaitReceiveSettlement: ' + outcome, outcome === 'settled' ? 'ok' : 'warn');
    } catch (e) {
      setRecvOut('Error: ' + e);
      addLog('awaitReceiveSettlement failed: ' + e, 'err');
    }
  }

  // ── 3. Send asset (RGB → Lightning) ────────────────────────────────────────

  async function handleSendAsset() {
    const l = requireLsp(setSendOut);
    if (!l) return;
    if (!sendRgbInvoice.trim()) return setSendOut('Enter the recipient RGB invoice');
    try {
      addLog('LSP sendAsset...', 'info');
      const res = await l.sendAsset({ rgbInvoice: sendRgbInvoice.trim() });
      setSendOut(json(res));
      addLog('sendAsset ok', 'ok');
    } catch (e) {
      setSendOut('Error: ' + e);
      addLog('sendAsset failed: ' + e, 'err');
    }
  }

  // ── 4. Pay Lightning Address ───────────────────────────────────────────────

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

  // ── 5. APay / Lightning Address (offline receive) ──────────────────────────

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

  // ── 6. Direct APay node calls (no LSP composition) ─────────────────────────

  async function handleApayNew() {
    if (!utexo) return setApayOut('No UTEXO wallet active');
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
    if (!utexo) return setApayOut('No UTEXO wallet active');
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
    <div>
      <h1 className="text-[#58a6ff] text-2xl font-bold mb-1">LSP & APay</h1>
      <p className="text-[#8b949e] text-sm mb-8">
        utexo-lsp composed flows (RGB ↔ Lightning bridge, Lightning Address) and async payments
        (APay), backed by the active UTEXOWallet.
      </p>

      <RegtestLspFlow />

      <ApayCartCheckout />

      <RegularChannelFlow />

      <KeysendReproFlow />

      <Section
        title="1. Create + Connect"
        hint="UTEXOWallet.createLsp() — leave peer fields blank to auto-discover from the wallet's lspBaseUrl (GET /get_info)."
      >
        {warn}
        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="LSP Base URL (optional if wallet has lspBaseUrl)">
            <input value={lspBaseUrl} onChange={(e) => setLspBaseUrl(e.target.value)} className={inputCls} placeholder="https://lsp.utexo.com" />
          </Field>
          <Field label="Peer Port">
            <input value={peerPort} onChange={(e) => setPeerPort(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="Peer Pubkey (optional — explicit peer)">
            <input value={peerPubkey} onChange={(e) => setPeerPubkey(e.target.value)} className={inputCls} placeholder="leave blank to auto-discover" />
          </Field>
          <Field label="Peer Host (optional)">
            <input value={peerHost} onChange={(e) => setPeerHost(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Bearer Token (APay routes)">
            <input value={bearerToken} onChange={(e) => setBearerToken(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <div className="flex gap-2 flex-wrap mb-2">
          <Btn onClick={handleCreateLsp} disabled={!utexo}>Create LSP</Btn>
          <Btn variant="accent" onClick={handleConnect} disabled={!lsp}>Connect + get_info</Btn>
        </div>
        <OutputBox value={connectOut} />
      </Section>

      <Section title="2. Receive Asset (Lightning → RGB)" hint="receiveAsset() then awaitReceiveSettlement() — share the returned rgbInvoice with the on-chain sender.">
        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="Asset ID">
            <input value={recvAssetId} onChange={(e) => setRecvAssetId(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Amount (sats)">
            <input value={recvSats} onChange={(e) => setRecvSats(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Amount (RGB)">
            <input value={recvRgb} onChange={(e) => setRecvRgb(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <div className="flex gap-2 flex-wrap mb-2">
          <Btn onClick={handleReceiveAsset} disabled={!lsp}>receiveAsset</Btn>
          <Btn variant="accent" onClick={handleAwaitSettlement} disabled={!lsp || !recvLnInvoice}>awaitReceiveSettlement</Btn>
        </div>
        <OutputBox value={recvOut} />
      </Section>

      <Section title="3. Send Asset (RGB → Lightning)" hint="sendAsset() — submit the recipient's on-chain RGB invoice; the LSP returns a BOLT11 which the wallet pays.">
        <Field label="Recipient RGB Invoice">
          <input value={sendRgbInvoice} onChange={(e) => setSendRgbInvoice(e.target.value)} className={inputCls} placeholder="rgb:..." />
        </Field>
        <Btn onClick={handleSendAsset} disabled={!lsp} className="mb-2">sendAsset</Btn>
        <OutputBox value={sendOut} />
      </Section>

      <Section title="4. Pay Lightning Address" hint="payAddress() — resolves the address (LNURL) and pays it.">
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

      <Section title="5. APay — Lightning Address & Hash Pool" hint="enableLightningAddress() registers an attested hash batch; refill/claim manage the pool.">
        {warn}
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
  );
}
