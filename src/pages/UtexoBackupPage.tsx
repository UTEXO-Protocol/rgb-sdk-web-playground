import React, { useState, useEffect } from 'react';
import {
  restoreUtxoWalletFromBackup,
  restoreUtxoWalletFromVss,
  buildVssConfigFromMnemonic,
  type UtxoNetworkPreset,
  type UTEXOWallet,
} from '@utexo/rgb-sdk-web';
import { useStore } from '../store';
import { Section } from '../components/Section';
import { Field, inputCls, selectCls } from '../components/Field';
import { Btn } from '../components/Btn';
import { OutputBox } from '../components/OutputBox';
import { useActiveWallet } from '../hooks/useActiveWallet';
import { downloadBytes } from '../lib/utils';

const VSS_URL = window.location.origin + '/vss';

export function UtexoBackupPage() {
  const addLog = useStore((s) => s.addLog);
  const activeWallet = useActiveWallet();
  const utexo = activeWallet?.type === 'utexo' ? activeWallet.instance as UTEXOWallet : null;
  const activeMnemonic = activeWallet?.config.mnemonic ?? '';
  const activeNetwork = activeWallet?.config.network ?? '';

  // ── File backup ──────────────────────────────────────────────────────────
  const [backupPwd, setBackupPwd] = useState('');
  const [lastLayer1Bytes, setLastLayer1Bytes] = useState<Uint8Array | null>(null);
  const [lastUtexoBytes, setLastUtexoBytes] = useState<Uint8Array | null>(null);
  const [backupOut, setBackupOut] = useState('');

  // ── File restore ─────────────────────────────────────────────────────────
  const [layer1File, setLayer1File] = useState<File | null>(null);
  const [utexoFile, setUtexoFile] = useState<File | null>(null);
  const [restoreMnemonic, setRestoreMnemonic] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const [restoreNetwork, setRestoreNetwork] = useState<UtxoNetworkPreset>('testnet');
  const [restoreOut, setRestoreOut] = useState('');

  // ── VSS backup ────────────────────────────────────────────────────────────
  const [vssUrl, setVssUrl] = useState(VSS_URL);
  const [vssMnemonic, setVssMnemonic] = useState('');
  const [vssNetwork, setVssNetwork] = useState<UtxoNetworkPreset>('testnet');
  const [vssBackupOut, setVssBackupOut] = useState('');

  // ── VSS restore ───────────────────────────────────────────────────────────
  const [vssRestoreUrl, setVssRestoreUrl] = useState(VSS_URL);
  const [vssRestoreMnemonic, setVssRestoreMnemonic] = useState('');
  const [vssRestoreNetwork, setVssRestoreNetwork] = useState<UtxoNetworkPreset>('testnet');
  const [vssRestoreOut, setVssRestoreOut] = useState('');

  useEffect(() => {
    if (activeMnemonic) {
      setRestoreMnemonic(activeMnemonic);
      setVssMnemonic(activeMnemonic);
      setVssRestoreMnemonic(activeMnemonic);
    }
    if (activeNetwork === 'mainnet' || activeNetwork === 'testnet') {
      setRestoreNetwork(activeNetwork);
      setVssNetwork(activeNetwork as UtxoNetworkPreset);
      setVssRestoreNetwork(activeNetwork as UtxoNetworkPreset);
    }
  }, [activeMnemonic, activeNetwork]);

  const utexoWarn = !utexo && (
    <p className="text-xs text-[#d29922] mb-3">Switch to a UTEXOWallet wallet in the header to use these operations.</p>
  );

  async function handleBackup() {
    if (!utexo) { setBackupOut('Switch to a UTEXOWallet wallet'); return; }
    if (!backupPwd) { setBackupOut('Enter a password'); return; }
    try {
      addLog('Creating UTEXOWallet backup (layer1 + utexo)...', 'info');
      const result = await utexo.createBackup({ password: backupPwd });
      const { layer1Bytes, utexoBytes } = result as { layer1Bytes: Uint8Array; utexoBytes: Uint8Array };
      setLastLayer1Bytes(layer1Bytes);
      setLastUtexoBytes(utexoBytes);
      setBackupOut('Backup created\nlayer1: ' + layer1Bytes.byteLength + ' bytes\nutexo: ' + utexoBytes.byteLength + ' bytes');
      addLog('UTEXOWallet backup created', 'ok');
    } catch (e) {
      setBackupOut('Error: ' + e);
      addLog('Backup failed: ' + e, 'err');
    }
  }

  async function handleRestore() {
    if (!layer1File || !utexoFile) { setRestoreOut('Select both layer1 and utexo backup files'); return; }
    if (!restoreMnemonic || !restorePassword) { setRestoreOut('Enter mnemonic and password'); return; }
    try {
      addLog('Reading backup files...', 'info');
      const l1 = new Uint8Array(await layer1File.arrayBuffer());
      const ut = new Uint8Array(await utexoFile.arrayBuffer());
      addLog('Restoring UTEXOWallet from bytes (' + restoreNetwork + ')...', 'info');
      await restoreUtxoWalletFromBackup({ layer1Bytes: l1, utexoBytes: ut, password: restorePassword, mnemonic: restoreMnemonic.trim(), networkPreset: restoreNetwork });
      setRestoreOut('Restore complete.\n⚠️ Session-only: file restore updates in-memory state only — it does NOT write to IndexedDB.\nState will be lost on page refresh. Use VSS restore for persistent recovery.');
      addLog('UTEXOWallet restore complete', 'ok');
    } catch (e) {
      setRestoreOut('Error: ' + e);
      addLog('Restore failed: ' + e, 'err');
    }
  }

  async function handleVssBackup() {
    if (!utexo) { setVssBackupOut('Switch to a UTEXOWallet wallet'); return; }
    if (!vssMnemonic.trim()) { setVssBackupOut('Enter mnemonic'); return; }
    try {
      addLog('Building VSS config...', 'info');
      const config = await buildVssConfigFromMnemonic(vssMnemonic.trim(), vssUrl, vssNetwork);
      addLog('Configuring VSS backup...', 'info');
      await utexo.configureVssBackup(config);
      addLog('VSS backup starting...', 'info');
      await utexo.vssBackup(config, vssMnemonic.trim());
      setVssBackupOut('VSS backup complete\nServer: ' + vssUrl + '\nNetwork: ' + vssNetwork);
      addLog('UTEXOWallet VSS backup complete', 'ok');
    } catch (e) {
      setVssBackupOut('Error: ' + e);
      addLog('VSS backup failed: ' + e, 'err');
    }
  }

  async function handleVssRestore() {
    if (!vssRestoreMnemonic.trim()) { setVssRestoreOut('Enter your mnemonic'); return; }
    try {
      addLog('Restoring from VSS (' + vssRestoreNetwork + ')...', 'info');
      await restoreUtxoWalletFromVss({ mnemonic: vssRestoreMnemonic.trim(), networkPreset: vssRestoreNetwork, vssServerUrl: vssRestoreUrl });
      setVssRestoreOut('VSS restore complete. IndexedDB updated.\nCreate a new UTEXOWallet on the Wallet page to load the restored state.\n✓ This restore persists across page refreshes.');
      addLog('VSS restore complete', 'ok');
    } catch (e) {
      setVssRestoreOut('Error: ' + e);
      addLog('VSS restore failed: ' + e, 'err');
    }
  }

  return (
    <div>
      <h1 className="text-[#58a6ff] text-2xl font-bold mb-1">Backup & Restore — UTEXOWallet</h1>
      <p className="text-[#8b949e] text-sm mb-8">
        Encrypted file backup, VSS cloud backup and restore for UTEXOWallet (testnet / mainnet)
      </p>

      <Section title="1. File Backup" hint="createBackup() — returns layer1 + utexo bytes separately.">
        {utexoWarn}
        <div className="flex gap-4 items-end flex-wrap">
          <Field label="Password">
            <input type="password" value={backupPwd} onChange={(e) => setBackupPwd(e.target.value)} className={inputCls} placeholder="Secure password" />
          </Field>
          <Btn onClick={handleBackup} disabled={!utexo} className="mb-4">Create Backup</Btn>
        </div>
        <div className="flex gap-2 flex-wrap mb-2">
          <Btn variant="secondary" onClick={() => { if (lastLayer1Bytes) { downloadBytes(lastLayer1Bytes, 'wallet_layer1.backup'); addLog('layer1 downloaded', 'ok'); } }} disabled={!lastLayer1Bytes}>
            Download layer1
          </Btn>
          <Btn variant="secondary" onClick={() => { if (lastUtexoBytes) { downloadBytes(lastUtexoBytes, 'wallet_utexo.backup'); addLog('utexo downloaded', 'ok'); } }} disabled={!lastUtexoBytes}>
            Download utexo
          </Btn>
        </div>
        <OutputBox value={backupOut} />
      </Section>

      <Section title="2. File Restore" hint="restoreUtxoWalletFromBackup() — session-only: updates in-memory state, does not write to IndexedDB. State lost on refresh.">
        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="layer1 backup file">
            <input type="file" accept=".backup,*" onChange={(e) => setLayer1File(e.target.files?.[0] ?? null)} className={inputCls} />
          </Field>
          <Field label="utexo backup file">
            <input type="file" accept=".backup,*" onChange={(e) => setUtexoFile(e.target.files?.[0] ?? null)} className={inputCls} />
          </Field>
        </div>
        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="Mnemonic">
            <input value={restoreMnemonic} onChange={(e) => setRestoreMnemonic(e.target.value)} className={inputCls} placeholder="twelve word mnemonic..." />
          </Field>
          <Field label="Network">
            <select value={restoreNetwork} onChange={(e) => setRestoreNetwork(e.target.value as UtxoNetworkPreset)} className={selectCls}>
              <option value="testnet">testnet</option>
              <option value="mainnet">mainnet</option>
            </select>
          </Field>
        </div>
        <div className="flex gap-4 items-end flex-wrap">
          <Field label="Password">
            <input type="password" value={restorePassword} onChange={(e) => setRestorePassword(e.target.value)} className={inputCls} placeholder="Password used during backup" />
          </Field>
          <Btn variant="danger" onClick={handleRestore} className="mb-4">Restore from Files</Btn>
        </div>
        <OutputBox value={restoreOut} />
      </Section>

      <Section title="3. VSS Cloud Backup" hint="configureVssBackup() + vssBackup() — back up both layer1 and utexo state to the VSS server.">
        {utexoWarn}
        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="VSS Server URL">
            <input value={vssUrl} onChange={(e) => setVssUrl(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Network">
            <select value={vssNetwork} onChange={(e) => setVssNetwork(e.target.value as UtxoNetworkPreset)} className={selectCls}>
              <option value="testnet">testnet</option>
              <option value="mainnet">mainnet</option>
            </select>
          </Field>
        </div>
        <div className="flex gap-4 items-end flex-wrap">
          <Field label="Mnemonic (to derive VSS signing key)">
            <input value={vssMnemonic} onChange={(e) => setVssMnemonic(e.target.value)} className={inputCls} placeholder="twelve word mnemonic..." />
          </Field>
          <Btn onClick={handleVssBackup} disabled={!utexo} className="mb-4">VSS Backup</Btn>
        </div>
        <OutputBox value={vssBackupOut} />
      </Section>

      <Section title="4. VSS Restore" hint="restoreUtxoWalletFromVss() — restore wallet state from cloud using only your mnemonic.">
        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="VSS Server URL">
            <input value={vssRestoreUrl} onChange={(e) => setVssRestoreUrl(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Network">
            <select value={vssRestoreNetwork} onChange={(e) => setVssRestoreNetwork(e.target.value as UtxoNetworkPreset)} className={selectCls}>
              <option value="testnet">testnet</option>
              <option value="mainnet">mainnet</option>
            </select>
          </Field>
        </div>
        <div className="flex gap-4 items-end flex-wrap">
          <Field label="Mnemonic">
            <input value={vssRestoreMnemonic} onChange={(e) => setVssRestoreMnemonic(e.target.value)} className={inputCls} placeholder="twelve word mnemonic..." />
          </Field>
          <Btn variant="danger" onClick={handleVssRestore} className="mb-4">VSS Restore</Btn>
        </div>
        <OutputBox value={vssRestoreOut} />
      </Section>
    </div>
  );
}
