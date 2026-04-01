import React, { useState, useEffect } from 'react';
import { generateKeys, WalletManager, UTEXOWallet, deriveKeysFromMnemonic } from '@utexo/rgb-sdk-web';
import { useStore } from '../store';
import type { WalletInstance, WalletConfig } from '../store';
import { Section } from '../components/Section';
import { Field, inputCls, selectCls, textareaCls } from '../components/Field';
import { Btn } from '../components/Btn';
import { OutputBox } from '../components/OutputBox';
import { ManagerOps } from '../components/ManagerOps';
import { UtexoOps } from '../components/UtexoOps';
import { useActiveWallet } from '../hooks/useActiveWallet';
import { json, getIndexerUrl, proxyIndexerUrl, getTransportEndpoint } from '../lib/utils';
import { saveSessions, setUrlWallet, clearSessions } from '../lib/session';

let walletCounter = 0;
function nextId() {
  return 'w' + (++walletCounter) + '_' + Date.now();
}

export function WalletPage() {
  const addLog = useStore((s) => s.addLog);
  const addWallet = useStore((s) => s.addWallet);
  const removeWallet = useStore((s) => s.removeWallet);
  const wallets = useStore((s) => s.wallets);
  const activeWalletId = useStore((s) => s.activeWalletId);
  const activeWallet = useActiveWallet();

  const [walletType, setWalletType] = useState<'manager' | 'utexo'>('manager');
  const [network, setNetwork] = useState('signet');
  const [mnemonic, setMnemonic] = useState('');
  const [label, setLabel] = useState('');
  const [indexerUrl, setIndexerUrl] = useState('');
  const [transportEndpoint, setTransportEndpoint] = useState('');
  const [creating, setCreating] = useState(false);
  const [createOut, setCreateOut] = useState('');
  const [showMnemonic, setShowMnemonic] = useState(false);

  useEffect(() => {
    setIndexerUrl(getIndexerUrl(network));
    setTransportEndpoint(getTransportEndpoint(network));
  }, [network]);

  // UTEXOWallet only supports mainnet/testnet
  const managerNetworks = ['signet', 'testnet', 'testnet4', 'regtest', 'mainnet'];
  const utexoNetworks = ['testnet', 'mainnet'];

  function effectiveNetwork() {
    if (walletType === 'utexo' && !utexoNetworks.includes(network)) {
      return 'testnet';
    }
    return network;
  }

  async function handleGenMnemonic() {
    try {
      const keys = await generateKeys(effectiveNetwork());
      setMnemonic(keys.mnemonic);
      addLog('Mnemonic generated', 'ok');
    } catch (e) {
      addLog('Generate mnemonic failed: ' + e, 'err');
    }
  }

  async function handleCreate() {
    if (!mnemonic.trim()) { setCreateOut('Generate or enter a mnemonic first'); return; }
    setCreating(true);
    setCreateOut('Creating wallet...');
    try {
      const net = effectiveNetwork();
      const walletLabel = label.trim() || (walletType === 'manager' ? 'WalletManager' : 'UTEXOWallet') + ' (' + net + ')';

      if (walletType === 'manager') {
        addLog('Deriving keys...', 'info');
        const keys = await deriveKeysFromMnemonic(net, mnemonic.trim());
        addLog('Creating WalletManager (' + net + ')...', 'info');
        const m = await WalletManager.create({
          mnemonic: mnemonic.trim(),
          xpubVan: keys.accountXpubVanilla,
          xpubCol: keys.accountXpubColored,
          masterFingerprint: keys.masterFingerprint,
          network: net,
          indexerUrl: indexerUrl ? proxyIndexerUrl(indexerUrl) : undefined,
          transportEndpoint: transportEndpoint || undefined,
        });

        const config: WalletConfig = {
          network: net,
          indexerUrl,
          transportEndpoint,
          masterFingerprint: keys.masterFingerprint,
          xpubVan: keys.accountXpubVanilla,
          xpubCol: keys.accountXpubColored,
          mnemonic: mnemonic.trim(),
        };

        const w: WalletInstance = {
          id: nextId(),
          label: walletLabel,
          type: 'manager',
          config,
          instance: m,
          online: false,
        };

        addWallet(w);
        const nextWallets = [...wallets, w];
        saveSessions(nextWallets, w.id);
        setUrlWallet(w.id);
        setCreateOut('WalletManager created\nLabel: ' + walletLabel + '\nNetwork: ' + net + '\nIndexer: ' + indexerUrl + '\nTransport: ' + transportEndpoint + '\nFingerprint: ' + keys.masterFingerprint);
        addLog('WalletManager "' + walletLabel + '" created', 'ok');
      } else {
        const preset = net === 'mainnet' ? 'mainnet' : 'testnet';
        addLog('Creating UTEXOWallet (' + preset + ')...', 'info');
        const w_inst = new UTEXOWallet(mnemonic.trim(), { network: preset as 'mainnet' | 'testnet' });
        addLog('Initializing...', 'info');
        await w_inst.initialize();

        const config: WalletConfig = {
          network: net,
          indexerUrl,
          transportEndpoint,
          masterFingerprint: '',
          xpubVan: '',
          xpubCol: '',
          mnemonic: mnemonic.trim(),
        };

        const w: WalletInstance = {
          id: nextId(),
          label: walletLabel,
          type: 'utexo',
          config,
          instance: w_inst,
          online: false,
        };

        addWallet(w);
        const nextWallets = [...wallets, w];
        saveSessions(nextWallets, w.id);
        setUrlWallet(w.id);
        setCreateOut('UTEXOWallet created and initialized\nLabel: ' + walletLabel + '\nNetwork preset: ' + preset);
        addLog('UTEXOWallet "' + walletLabel + '" created', 'ok');
      }

      setMnemonic('');
      setLabel('');
    } catch (e) {
      setCreateOut('Error: ' + e);
      addLog('Create failed: ' + e, 'err');
    } finally {
      setCreating(false);
    }
  }

  function handleClearAll() {
    if (!window.confirm('Remove ALL saved wallets from localStorage? Wallet instances will be lost.')) return;
    clearSessions();
    wallets.forEach((w) => {
      if (w.type === 'manager') {
        (w.instance as WalletManager).dispose().catch(() => {});
      }
    });
    window.location.replace('/');
  }

  async function handleDispose() {
    if (!activeWallet) return;
    if (!window.confirm('Remove wallet "' + activeWallet.label + '"? This clears the instance from memory.')) return;
    if (activeWallet.type === 'manager') {
      try { await (activeWallet.instance as WalletManager).dispose(); } catch {}
    }
    removeWallet(activeWallet.id);
    const remaining = wallets.filter((w) => w.id !== activeWallet.id);
    saveSessions(remaining, remaining[remaining.length - 1]?.id ?? null);
    addLog('Wallet "' + activeWallet.label + '" removed', 'warn');
  }

  return (
    <div>
      <h1 className="text-[#58a6ff] text-2xl font-bold mb-1">Wallet</h1>
      <p className="text-[#8b949e] text-sm mb-6">
        Create and manage WalletManager or UTEXOWallet instances
      </p>

      {/* Create Wallet */}
      <Section title="Create Wallet">
        <div className="flex gap-4 mb-4 flex-wrap">
          <Field label="Type">
            <select value={walletType} onChange={(e) => { setWalletType(e.target.value as 'manager' | 'utexo'); setNetwork(e.target.value === 'utexo' ? 'testnet' : 'signet'); }} className={selectCls}>
              <option value="manager">WalletManager</option>
              <option value="utexo">UTEXOWallet</option>
            </select>
          </Field>
          <Field label="Network">
            <select value={network} onChange={(e) => setNetwork(e.target.value)} className={selectCls}>
              {(walletType === 'utexo' ? utexoNetworks : managerNetworks).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </Field>
          <Field label="Label (optional)">
            <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls} placeholder='e.g. "Alice" or "Bob"' />
          </Field>
        </div>

        <Field label="Mnemonic">
          <textarea
            value={mnemonic}
            onChange={(e) => setMnemonic(e.target.value)}
            className={textareaCls}
            rows={2}
            placeholder="Enter 12/24-word mnemonic, or click Generate"
          />
        </Field>
        <div className="flex gap-2 mb-4 flex-wrap">
          <Btn variant="secondary" onClick={handleGenMnemonic} disabled={creating}>Generate Mnemonic</Btn>
        </div>

        {walletType === 'manager' && (
          <div className="flex gap-4 mb-4 flex-wrap">
            <Field label="Indexer URL">
              <input value={indexerUrl} onChange={(e) => setIndexerUrl(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Transport endpoint (RGB proxy)">
              <input value={transportEndpoint} onChange={(e) => setTransportEndpoint(e.target.value)} className={inputCls} />
            </Field>
          </div>
        )}

        <Btn onClick={handleCreate} disabled={creating}>
          {creating ? 'Creating...' : walletType === 'manager' ? 'WalletManager.create()' : 'new UTEXOWallet + initialize()'}
        </Btn>
        <OutputBox value={createOut} />
      </Section>

      {/* Active Wallet Info */}
      {activeWallet && (
        <Section title={'Active: ' + activeWallet.label}>
          <div className="bg-[#161b22] border border-[#30363d] rounded p-4 font-mono text-xs leading-relaxed space-y-1 mb-4">
            <div><span className="text-[#8b949e]">type:</span> <span className="text-[#58a6ff]">{activeWallet.type}</span></div>
            <div><span className="text-[#8b949e]">network:</span> <span className="text-[#c9d1d9]">{activeWallet.config.network}</span></div>
            <div><span className="text-[#8b949e]">online:</span> <span className={activeWallet.online ? 'text-[#3fb950]' : 'text-[#484f58]'}>{activeWallet.online ? 'yes' : 'no'}</span></div>
            {activeWallet.config.indexerUrl && (
              <div><span className="text-[#8b949e]">indexer:</span> <span className="text-[#c9d1d9]">{activeWallet.config.indexerUrl}</span></div>
            )}
            {activeWallet.config.transportEndpoint && (
              <div><span className="text-[#8b949e]">transport:</span> <span className="text-[#c9d1d9]">{activeWallet.config.transportEndpoint}</span></div>
            )}
            {activeWallet.config.masterFingerprint && (
              <div><span className="text-[#8b949e]">fingerprint:</span> <span className="text-[#c9d1d9]">{activeWallet.config.masterFingerprint}</span></div>
            )}
            {activeWallet.config.xpubVan && (
              <div className="break-all"><span className="text-[#8b949e]">xpubVan:</span> <span className="text-[#c9d1d9]">{activeWallet.config.xpubVan}</span></div>
            )}
            {activeWallet.config.xpubCol && (
              <div className="break-all"><span className="text-[#8b949e]">xpubCol:</span> <span className="text-[#c9d1d9]">{activeWallet.config.xpubCol}</span></div>
            )}
            <div className="pt-1">
              <button
                onClick={() => setShowMnemonic((v) => !v)}
                className="text-[#8b949e] hover:text-[#58a6ff] text-xs underline"
              >
                {showMnemonic ? 'hide mnemonic' : 'show mnemonic'}
              </button>
              {showMnemonic && (
                <div className="mt-1 text-[#d29922] break-words">{activeWallet.config.mnemonic}</div>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <Btn variant="danger" onClick={handleDispose}>Remove Wallet</Btn>
            <Btn variant="danger" onClick={handleClearAll}>Clear All Saved</Btn>
          </div>
        </Section>
      )}

      {/* Type-specific operations */}
      {activeWallet?.type === 'manager' && (
        <ManagerOps
          manager={activeWallet.instance as WalletManager}
          walletId={activeWallet.id}
        />
      )}

      {activeWallet?.type === 'utexo' && (
        <UtexoOps
          utexo={activeWallet.instance as UTEXOWallet}
          walletId={activeWallet.id}
          network={activeWallet.config.network}
        />
      )}
    </div>
  );
}
