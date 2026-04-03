import React, { useState, useEffect } from 'react';
import {
  buildVssConfigFromMnemonic,
  type WalletManager,
} from '@utexo/rgb-sdk-web';
import { useStore } from '../store';
import { Section } from '../components/Section';
import { Field, inputCls, selectCls } from '../components/Field';
import { Btn } from '../components/Btn';
import { OutputBox } from '../components/OutputBox';
import { useActiveWallet } from '../hooks/useActiveWallet';
import { downloadBytes } from '../lib/utils';

const VSS_URL = 'https://vss-server.utexo.com';

const MANAGER_NETWORKS = ['utexo', 'signet', 'testnet', 'regtest', 'mainnet'] as const;

export function WalletManagerBackupPage() {
  const addLog = useStore((s) => s.addLog);
  const activeWallet = useActiveWallet();
  const manager = activeWallet?.type === 'manager' ? activeWallet.instance as WalletManager : null;
  const activeMnemonic = activeWallet?.config.mnemonic ?? '';
  const activeNetwork = activeWallet?.config.network ?? '';

  // ── File backup ──────────────────────────────────────────────────────────
  const [backupPwd, setBackupPwd] = useState('');
  const [lastBytes, setLastBytes] = useState<Uint8Array | null>(null);
  const [backupOut, setBackupOut] = useState('');

  // ── File restore ─────────────────────────────────────────────────────────
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restorePwd, setRestorePwd] = useState('');
  const [restoreOut, setRestoreOut] = useState('');

  // ── VSS cloud backup ─────────────────────────────────────────────────────
  const [vssUrl, setVssUrl] = useState(VSS_URL);
  const [vssMnemonic, setVssMnemonic] = useState('');
  const [vssNetwork, setVssNetwork] = useState('signet');
  const [vssBackupOut, setVssBackupOut] = useState('');
  const [vssInfoOut, setVssInfoOut] = useState('');
  const [vssDisableOut, setVssDisableOut] = useState('');
  const [vssRestoreOut, setVssRestoreOut] = useState('');

  useEffect(() => {
    if (activeMnemonic) setVssMnemonic(activeMnemonic);
    if (activeNetwork) setVssNetwork(activeNetwork);
  }, [activeMnemonic, activeNetwork]);

  const mgrWarn = !manager && (
    <p className="text-xs text-[#d29922] mb-3">Switch to a WalletManager wallet in the header to use these operations.</p>
  );

  async function handleBackup() {
    if (!manager) { setBackupOut('Switch to a WalletManager wallet'); return; }
    if (!backupPwd) { setBackupOut('Enter a password'); return; }
    try {
      addLog('Creating WalletManager backup...', 'info');
      await manager.createBackup({ backupPath: '', password: backupPwd });
      const bytes = manager.getLastBackupBytes();
      setLastBytes(bytes ?? null);
      const size = bytes?.byteLength ?? 0;
      setBackupOut('Backup created — ' + size + ' bytes\nClick Download to save the file.');
      addLog('WalletManager backup created (' + size + ' bytes)', 'ok');
    } catch (e) {
      setBackupOut('Error: ' + e);
      addLog('Backup failed: ' + e, 'err');
    }
  }

  function handleDownload() {
    if (!lastBytes) { addLog('No backup bytes — create a backup first', 'warn'); return; }
    downloadBytes(lastBytes, 'wallet_manager.backup');
    addLog('WalletManager backup downloaded', 'ok');
  }

  async function handleRestore() {
    if (!manager) { setRestoreOut('Switch to a WalletManager wallet'); return; }
    if (!restoreFile || !restorePwd) { setRestoreOut('Select a file and enter password'); return; }
    try {
      addLog('Reading backup file...', 'info');
      const bytes = new Uint8Array(await restoreFile.arrayBuffer());
      addLog('Restoring from ' + bytes.byteLength + ' bytes...', 'info');
      manager.restoreFromBackupBytes(bytes, restorePwd);
      setRestoreOut('Restored from backup successfully.\n⚠️ Session-only: WalletManager uses in-memory storage — state will be lost on page refresh.');
      addLog('WalletManager restore complete (session-only)', 'ok');
    } catch (e) {
      setRestoreOut('Error: ' + e);
      addLog('Restore failed: ' + e, 'err');
    }
  }

  async function handleVssBackup() {
    if (!manager) { setVssBackupOut('Switch to a WalletManager wallet'); return; }
    if (!vssMnemonic.trim()) { setVssBackupOut('Enter mnemonic'); return; }
    try {
      addLog('Building VSS config...', 'info');
      const config = await buildVssConfigFromMnemonic(vssMnemonic.trim(), vssUrl, vssNetwork as never);
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
      const config = await buildVssConfigFromMnemonic(vssMnemonic.trim(), vssUrl, vssNetwork as never);
      const info = await manager.vssBackupInfo(config);
      setVssInfoOut(JSON.stringify(info, null, 2));
      addLog('VSS backup info retrieved', 'ok');
    } catch (e) {
      setVssInfoOut('Error: ' + e);
      addLog('vssBackupInfo failed: ' + e, 'err');
    }
  }

  async function handleVssRestore() {
    if (!manager) { setVssRestoreOut('Switch to a WalletManager wallet'); return; }
    if (!vssMnemonic.trim()) { setVssRestoreOut('Enter mnemonic'); return; }
    try {
      addLog('Building VSS config for restore...', 'info');
      const config = await buildVssConfigFromMnemonic(vssMnemonic.trim(), vssUrl, vssNetwork as never);
      addLog('Configuring VSS...', 'info');
      await manager.configureVssBackup(config);
      addLog('Restoring from VSS...', 'info');
      // vssRestoreBackup is on the internal binding, not exposed on WalletManager's public API
      await (manager as unknown as { client: { vssRestoreBackup(): Promise<void> } }).client.vssRestoreBackup();
      setVssRestoreOut('VSS restore complete.\nWallet state restored from cloud.\n⚠️ Session-only: WalletManager uses in-memory storage — state will be lost on page refresh.');
      addLog('VSS restore complete', 'ok');
    } catch (e) {
      setVssRestoreOut('Error: ' + e);
      addLog('VSS restore failed: ' + e, 'err');
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

  return (
    <div>
      <h1 className="text-[#58a6ff] text-2xl font-bold mb-1">Backup & Restore — WalletManager</h1>
      <p className="text-[#8b949e] text-sm mb-8">
        Encrypted file backup and VSS cloud backup for WalletManager wallets (signet / testnet / regtest / mainnet / utexo)
      </p>

      <Section title="1. File Backup" hint="createBackup() — encrypted bytes in memory, no filesystem access.">
        {mgrWarn}
        <div className="flex gap-4 items-end flex-wrap">
          <Field label="Password">
            <input type="password" value={backupPwd} onChange={(e) => setBackupPwd(e.target.value)} className={inputCls} placeholder="Secure password" />
          </Field>
          <Btn onClick={handleBackup} disabled={!manager} className="mb-4">Create Backup</Btn>
          <Btn variant="secondary" onClick={handleDownload} disabled={!lastBytes} className="mb-4">Download</Btn>
        </div>
        <OutputBox value={backupOut} />
      </Section>

      <Section title="2. File Restore" hint="restoreFromBackupBytes() — session-only: WalletManager uses in-memory storage, so restored state is lost on page refresh.">
        {mgrWarn}
        <Field label="Backup file">
          <input type="file" accept=".backup,*" onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)} className={inputCls} />
        </Field>
        <div className="flex gap-4 items-end flex-wrap">
          <Field label="Password">
            <input type="password" value={restorePwd} onChange={(e) => setRestorePwd(e.target.value)} className={inputCls} placeholder="Password used during backup" />
          </Field>
          <Btn variant="danger" onClick={handleRestore} disabled={!manager} className="mb-4">Restore</Btn>
        </div>
        <OutputBox value={restoreOut} />
      </Section>

      <Section title="3. VSS Cloud Backup & Restore" hint="configureVssBackup() + vssBackup() to back up; configureVssBackup() + vssRestoreBackup() to restore.">
        {mgrWarn}
        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="VSS Server URL">
            <input value={vssUrl} onChange={(e) => setVssUrl(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Network">
            <select value={vssNetwork} onChange={(e) => setVssNetwork(e.target.value)} className={selectCls}>
              {MANAGER_NETWORKS.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Mnemonic (to derive VSS signing key)">
          <input value={vssMnemonic} onChange={(e) => setVssMnemonic(e.target.value)} className={inputCls} placeholder="twelve word mnemonic..." />
        </Field>
        <div className="flex gap-2 flex-wrap mb-2">
          <Btn onClick={handleVssBackup} disabled={!manager}>VSS Backup</Btn>
          <Btn variant="secondary" onClick={handleVssBackupInfo} disabled={!manager}>Get Backup Info</Btn>
          <Btn variant="accent" onClick={handleVssRestore} disabled={!manager}>VSS Restore</Btn>
          <Btn variant="danger" onClick={handleDisableVssAutoBackup} disabled={!manager}>Disable Auto-Backup</Btn>
        </div>
        <OutputBox value={vssBackupOut || vssInfoOut || vssRestoreOut || vssDisableOut} />
      </Section>
    </div>
  );
}
