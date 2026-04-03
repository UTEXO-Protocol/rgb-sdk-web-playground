import React, { useState, useEffect } from 'react';
import {
  restoreUtxoWalletFromBackup,
  restoreUtxoWalletFromVss,
  buildVssConfigFromMnemonic,
  type UtxoNetworkPreset,
  type WalletManager,
  type UTEXOWallet,
} from '@utexo/rgb-sdk-web';
import { useStore } from '../store';
import { Section } from '../components/Section';
import { Field, inputCls, selectCls } from '../components/Field';
import { Btn } from '../components/Btn';
import { OutputBox } from '../components/OutputBox';
import { useActiveWallet } from '../hooks/useActiveWallet';
import { downloadBytes } from '../lib/utils';

const VSS_URL = 'https://vss-server.utexo.com';

function GroupHeading({ title, badge }: { title: string; badge: string }) {
  return (
    <div className="flex items-center gap-3 mb-4 mt-2">
      <h2 className="text-[#c9d1d9] text-lg font-semibold">{title}</h2>
      <span className="text-xs px-2 py-0.5 rounded bg-[#161b22] border border-[#30363d] text-[#8b949e]">{badge}</span>
    </div>
  );
}

export function BackupPage() {
  const addLog = useStore((s) => s.addLog);
  const activeWallet = useActiveWallet();
  const manager = activeWallet?.type === 'manager' ? activeWallet.instance as WalletManager : null;
  const utexo = activeWallet?.type === 'utexo' ? activeWallet.instance as UTEXOWallet : null;
  const activeMnemonic = activeWallet?.config.mnemonic ?? '';
  const activeNetwork = activeWallet?.config.network ?? '';

  // ── WalletManager file backup ─────────────────────────────────────────────
  const [mgrBackupPwd, setMgrBackupPwd] = useState('');
  const [mgrRestoreFile, setMgrRestoreFile] = useState<File | null>(null);
  const [mgrRestorePwd, setMgrRestorePwd] = useState('');
  const [lastMgrBytes, setLastMgrBytes] = useState<Uint8Array | null>(null);
  const [mgrBackupOut, setMgrBackupOut] = useState('');
  const [mgrRestoreOut, setMgrRestoreOut] = useState('');

  // ── WalletManager VSS ─────────────────────────────────────────────────────
  const [vssUrl, setVssUrl] = useState(VSS_URL);
  const [vssMnemonic, setVssMnemonic] = useState('');
  const [vssNetwork, setVssNetwork] = useState<UtxoNetworkPreset>('testnet');
  const [vssBackupOut, setVssBackupOut] = useState('');
  const [vssInfoOut, setVssInfoOut] = useState('');
  const [vssDisableOut, setVssDisableOut] = useState('');

  // ── UTEXOWallet file backup ───────────────────────────────────────────────
  const [utexoBackupPwd, setUtexoBackupPwd] = useState('');
  const [layer1File, setLayer1File] = useState<File | null>(null);
  const [utexoFile, setUtexoFile] = useState<File | null>(null);
  const [restoreMnemonic, setRestoreMnemonic] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const [restoreNetwork, setRestoreNetwork] = useState<UtxoNetworkPreset>('testnet');
  const [lastLayer1Bytes, setLastLayer1Bytes] = useState<Uint8Array | null>(null);
  const [lastUtexoBytes, setLastUtexoBytes] = useState<Uint8Array | null>(null);
  const [utexoBackupOut, setUtexoBackupOut] = useState('');
  const [bytesRestoreOut, setBytesRestoreOut] = useState('');

  // ── UTEXOWallet VSS restore ───────────────────────────────────────────────
  const [vssRestoreUrl, setVssRestoreUrl] = useState(VSS_URL);
  const [vssRestoreMnemonic, setVssRestoreMnemonic] = useState('');
  const [vssRestoreNetwork, setVssRestoreNetwork] = useState<UtxoNetworkPreset>('testnet');
  const [vssRestoreOut, setVssRestoreOut] = useState('');

  // Auto-fill mnemonic and network from active wallet
  useEffect(() => {
    if (activeMnemonic) {
      setVssMnemonic(activeMnemonic);
      setVssRestoreMnemonic(activeMnemonic);
      setRestoreMnemonic(activeMnemonic);
    }
    if (activeNetwork === 'mainnet' || activeNetwork === 'testnet') {
      setVssNetwork(activeNetwork);
      setVssRestoreNetwork(activeNetwork);
      setRestoreNetwork(activeNetwork);
    }
  }, [activeMnemonic, activeNetwork]);

  // ── WalletManager handlers ────────────────────────────────────────────────

  async function handleMgrBackup() {
    if (!manager) { setMgrBackupOut('Switch to a WalletManager wallet'); return; }
    if (!mgrBackupPwd) { setMgrBackupOut('Enter a password'); return; }
    try {
      addLog('Creating WalletManager backup...', 'info');
      await manager.createBackup({ backupPath: '', password: mgrBackupPwd });
      const bytes = manager.getLastBackupBytes();
      setLastMgrBytes(bytes ?? null);
      const size = bytes?.byteLength ?? 0;
      setMgrBackupOut('Backup created — ' + size + ' bytes\nClick Download to save the file.');
      addLog('WalletManager backup created (' + size + ' bytes)', 'ok');
    } catch (e) {
      setMgrBackupOut('Error: ' + e);
      addLog('Backup failed: ' + e, 'err');
    }
  }

  function handleMgrDownload() {
    if (!lastMgrBytes) { addLog('No backup bytes — create a backup first', 'warn'); return; }
    downloadBytes(lastMgrBytes, 'wallet_manager.backup');
    addLog('WalletManager backup downloaded', 'ok');
  }

  async function handleMgrRestore() {
    if (!manager) { setMgrRestoreOut('Switch to a WalletManager wallet'); return; }
    if (!mgrRestoreFile || !mgrRestorePwd) { setMgrRestoreOut('Select a file and enter password'); return; }
    try {
      addLog('Reading backup file...', 'info');
      const bytes = new Uint8Array(await mgrRestoreFile.arrayBuffer());
      addLog('Restoring from ' + bytes.byteLength + ' bytes...', 'info');
      manager.restoreFromBackupBytes(bytes, mgrRestorePwd);
      setMgrRestoreOut('Restored from backup successfully');
      addLog('WalletManager restore complete', 'ok');
    } catch (e) {
      setMgrRestoreOut('Error: ' + e);
      addLog('Restore failed: ' + e, 'err');
    }
  }

  async function handleVssBackup() {
    if (!manager) { setVssBackupOut('Switch to a WalletManager wallet'); return; }
    if (!vssMnemonic.trim()) { setVssBackupOut('Enter mnemonic'); return; }
    try {
      addLog('Building VSS config...', 'info');
      const config = await buildVssConfigFromMnemonic(vssMnemonic.trim(), vssUrl, vssNetwork);
      addLog('VSS backup starting...', 'info');
      await manager.configureVssBackup(config);
      await manager.vssBackup(config);
      setVssBackupOut('VSS backup completed\nServer: ' + vssUrl + '\nNetwork: ' + vssNetwork);
      addLog('VSS backup complete', 'ok');
    } catch (e) {
      setVssBackupOut('Error: ' + e);
      addLog('VSS backup failed: ' + e, 'err');
    }
  }

  async function handleVssBackupInfo() {
    if (!manager) { setVssInfoOut('Switch to a WalletManager wallet'); return; }
    if (!vssMnemonic.trim()) { setVssInfoOut('Enter mnemonic'); return; }
    try {
      const config = await buildVssConfigFromMnemonic(vssMnemonic.trim(), vssUrl, vssNetwork);
      const info = await manager.vssBackupInfo(config);
      setVssInfoOut(JSON.stringify(info, null, 2));
      addLog('VSS backup info retrieved', 'ok');
    } catch (e) {
      setVssInfoOut('Error: ' + e);
      addLog('vssBackupInfo failed: ' + e, 'err');
    }
  }

  async function handleDisableVssAutoBackup() {
    if (!manager) { setVssDisableOut('Switch to a WalletManager wallet'); return; }
    try {
      await manager.disableVssAutoBackup();
      setVssDisableOut('VSS auto-backup disabled');
      addLog('VSS auto-backup disabled', 'ok');
    } catch (e) {
      setVssDisableOut('Error: ' + e);
      addLog('disableVssAutoBackup failed: ' + e, 'err');
    }
  }

  // ── UTEXOWallet handlers ──────────────────────────────────────────────────

  async function handleUtexoBackup() {
    if (!utexo) { setUtexoBackupOut('Switch to a UTEXOWallet wallet'); return; }
    if (!utexoBackupPwd) { setUtexoBackupOut('Enter a password'); return; }
    try {
      addLog('Creating UTEXOWallet backup (layer1 + utexo)...', 'info');
      const result = await utexo.createBackup({ password: utexoBackupPwd });
      const { layer1Bytes, utexoBytes } = result as { layer1Bytes: Uint8Array; utexoBytes: Uint8Array };
      setLastLayer1Bytes(layer1Bytes);
      setLastUtexoBytes(utexoBytes);
      setUtexoBackupOut('Backup created\nlayer1: ' + layer1Bytes.byteLength + ' bytes\nutexo: ' + utexoBytes.byteLength + ' bytes');
      addLog('UTEXOWallet backup created', 'ok');
    } catch (e) {
      setUtexoBackupOut('Error: ' + e);
      addLog('Backup failed: ' + e, 'err');
    }
  }

  async function handleBytesRestore() {
    if (!layer1File || !utexoFile) { setBytesRestoreOut('Select both layer1 and utexo backup files'); return; }
    if (!restoreMnemonic || !restorePassword) { setBytesRestoreOut('Enter mnemonic and password'); return; }
    try {
      addLog('Reading backup files...', 'info');
      const l1 = new Uint8Array(await layer1File.arrayBuffer());
      const ut = new Uint8Array(await utexoFile.arrayBuffer());
      addLog('Restoring UTEXOWallet from bytes (' + restoreNetwork + ')...', 'info');
      await restoreUtxoWalletFromBackup({ layer1Bytes: l1, utexoBytes: ut, password: restorePassword, mnemonic: restoreMnemonic.trim(), networkPreset: restoreNetwork });
      setBytesRestoreOut('Restore complete. IndexedDB updated.\nCreate a new UTEXOWallet on the Wallet page to load the restored state.');
      addLog('UTEXOWallet restore complete', 'ok');
    } catch (e) {
      setBytesRestoreOut('Error: ' + e);
      addLog('Restore failed: ' + e, 'err');
    }
  }

  async function handleVssRestore() {
    if (!vssRestoreMnemonic.trim()) { setVssRestoreOut('Enter your mnemonic'); return; }
    try {
      addLog('Restoring from VSS (' + vssRestoreNetwork + ')...', 'info');
      await restoreUtxoWalletFromVss({ mnemonic: vssRestoreMnemonic.trim(), networkPreset: vssRestoreNetwork, vssServerUrl: vssRestoreUrl });
      setVssRestoreOut('VSS restore complete. IndexedDB updated.\nCreate a new UTEXOWallet on the Wallet page to load the restored state.');
      addLog('VSS restore complete', 'ok');
    } catch (e) {
      setVssRestoreOut('Error: ' + e);
      addLog('VSS restore failed: ' + e, 'err');
    }
  }

  const mgrWarn = !manager && (
    <p className="text-xs text-[#d29922] mb-3">Switch to a WalletManager wallet in the header to use these operations.</p>
  );
  const utexoWarn = !utexo && (
    <p className="text-xs text-[#d29922] mb-3">Switch to a UTEXOWallet wallet in the header to use these operations.</p>
  );

  return (
    <div>
      <h1 className="text-[#58a6ff] text-2xl font-bold mb-1">Backup & Restore</h1>
      <p className="text-[#8b949e] text-sm mb-8">
        Encrypted file backup and VSS cloud backup — mnemonic and network auto-filled from active wallet
      </p>

      {/* ── WalletManager ─────────────────────────────────────────────────── */}
      <GroupHeading title="WalletManager" badge="manager" />

      <Section title="1. File Backup" hint="createBackup() — encrypted bytes in memory, no filesystem access.">
        {mgrWarn}
        <div className="flex gap-4 items-end flex-wrap">
          <Field label="Password">
            <input type="password" value={mgrBackupPwd} onChange={(e) => setMgrBackupPwd(e.target.value)} className={inputCls} placeholder="Secure password" />
          </Field>
          <Btn onClick={handleMgrBackup} disabled={!manager} className="mb-4">Create Backup</Btn>
          <Btn variant="secondary" onClick={handleMgrDownload} disabled={!lastMgrBytes} className="mb-4">Download</Btn>
        </div>
        <OutputBox value={mgrBackupOut} />
      </Section>

      <Section title="2. File Restore" hint="restoreFromBackupBytes() — load state from a backup file into the active WalletManager.">
        {mgrWarn}
        <Field label="Backup file">
          <input type="file" accept=".backup,*" onChange={(e) => setMgrRestoreFile(e.target.files?.[0] ?? null)} className={inputCls} />
        </Field>
        <div className="flex gap-4 items-end flex-wrap">
          <Field label="Password">
            <input type="password" value={mgrRestorePwd} onChange={(e) => setMgrRestorePwd(e.target.value)} className={inputCls} placeholder="Password used during backup" />
          </Field>
          <Btn variant="danger" onClick={handleMgrRestore} disabled={!manager} className="mb-4">Restore</Btn>
        </div>
        <OutputBox value={mgrRestoreOut} />
      </Section>

      <Section title="3. VSS Cloud Backup" hint="configureVssBackup() + vssBackup() — back up wallet state to the VSS server.">
        {mgrWarn}
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
        <Field label="Mnemonic (to derive VSS signing key)">
          <input value={vssMnemonic} onChange={(e) => setVssMnemonic(e.target.value)} className={inputCls} placeholder="twelve word mnemonic..." />
        </Field>
        <div className="flex gap-2 flex-wrap mb-2">
          <Btn onClick={handleVssBackup} disabled={!manager}>VSS Backup</Btn>
          <Btn variant="secondary" onClick={handleVssBackupInfo} disabled={!manager}>Get Backup Info</Btn>
          <Btn variant="danger" onClick={handleDisableVssAutoBackup} disabled={!manager}>Disable Auto-Backup</Btn>
        </div>
        <OutputBox value={vssBackupOut || vssInfoOut || vssDisableOut} />
      </Section>

      {/* ── UTEXOWallet ───────────────────────────────────────────────────── */}
      <div className="border-t border-[#30363d] my-8" />
      <GroupHeading title="UTEXOWallet" badge="utexo" />

      <Section title="4. File Backup" hint="createBackup() — returns layer1 + utexo bytes separately.">
        {utexoWarn}
        <div className="flex gap-4 items-end flex-wrap">
          <Field label="Password">
            <input type="password" value={utexoBackupPwd} onChange={(e) => setUtexoBackupPwd(e.target.value)} className={inputCls} placeholder="Secure password" />
          </Field>
          <Btn onClick={handleUtexoBackup} disabled={!utexo} className="mb-4">Create Backup</Btn>
        </div>
        <div className="flex gap-2 flex-wrap mb-2">
          <Btn variant="secondary" onClick={() => { if (lastLayer1Bytes) { downloadBytes(lastLayer1Bytes, 'wallet_layer1.backup'); addLog('layer1 downloaded', 'ok'); } }} disabled={!lastLayer1Bytes}>
            Download layer1
          </Btn>
          <Btn variant="secondary" onClick={() => { if (lastUtexoBytes) { downloadBytes(lastUtexoBytes, 'wallet_utexo.backup'); addLog('utexo downloaded', 'ok'); } }} disabled={!lastUtexoBytes}>
            Download utexo
          </Btn>
        </div>
        <OutputBox value={utexoBackupOut} />
      </Section>

      <Section title="5. File Restore" hint="restoreUtxoWalletFromBackup() — restores both layer1 and utexo states into IndexedDB.">
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
          <Btn variant="danger" onClick={handleBytesRestore} className="mb-4">Restore from Files</Btn>
        </div>
        <OutputBox value={bytesRestoreOut} />
      </Section>

      <Section title="6. VSS Restore" hint="restoreUtxoWalletFromVss() — restore wallet state from cloud using only your mnemonic.">
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
