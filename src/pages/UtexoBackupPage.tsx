import { useState } from 'react';
import {
  DEFAULT_VSS_SERVER_URL,
  deriveVssSigningKeyFromMnemonic,
  type VssBackupConfig,
  type UTEXOWallet,
} from '@utexo/rgb-sdk-web';
import { useStore } from '../store';
import { Section } from '../components/Section';
import { Field, inputCls } from '../components/Field';
import { Btn } from '../components/Btn';
import { OutputBox } from '../components/OutputBox';
import { useActiveWallet } from '../hooks/useActiveWallet';
import { downloadBytes } from '../lib/utils';

export function UtexoBackupPage() {
  const addLog = useStore((s) => s.addLog);
  const activeWallet = useActiveWallet();
  const utexo =
    activeWallet?.type === 'utexo' ? (activeWallet.instance as UTEXOWallet) : null;
  const activeMnemonic = activeWallet?.config.mnemonic ?? '';
  const storeId = activeWallet?.config.masterFingerprint || 'utexo-store';

  // ── File backup ──────────────────────────────────────────────────────────
  const [backupPwd, setBackupPwd] = useState('');
  const [lastBytes, setLastBytes] = useState<Uint8Array | null>(null);
  const [backupOut, setBackupOut] = useState('');

  // ── File restore ─────────────────────────────────────────────────────────
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [restorePassword, setRestorePassword] = useState('');
  const [restoreOut, setRestoreOut] = useState('');

  // ── VSS backup ────────────────────────────────────────────────────────────
  const [vssUrl, setVssUrl] = useState(DEFAULT_VSS_SERVER_URL);
  const [vssOut, setVssOut] = useState('');

  const utexoWarn = !utexo && (
    <p className="text-xs text-[#d29922] mb-3">
      Switch to a UTEXO wallet in the header to use these operations.
    </p>
  );

  function buildVssConfig(): VssBackupConfig {
    return {
      serverUrl: vssUrl,
      storeId,
      signingKey: deriveVssSigningKeyFromMnemonic(activeMnemonic),
    };
  }

  async function handleBackup() {
    if (!utexo) return setBackupOut('Switch to a UTEXO wallet');
    if (!backupPwd) return setBackupOut('Enter a password');
    try {
      addLog('Creating UTEXOWallet backup...', 'info');
      const res = await utexo.createBackup({ backupPath: '', password: backupPwd });
      const bytes = utexo.getLastBackupBytes();
      setLastBytes(bytes);
      setBackupOut(
        `${res.message}\nbytes: ${bytes ? bytes.byteLength : 0}`
      );
      addLog('UTEXOWallet backup created', 'ok');
    } catch (e) {
      setBackupOut('Error: ' + e);
      addLog('Backup failed: ' + e, 'err');
    }
  }

  async function handleRestore() {
    if (!utexo) return setRestoreOut('Switch to a UTEXO wallet');
    if (!backupFile) return setRestoreOut('Select a backup file');
    if (!restorePassword) return setRestoreOut('Enter the backup password');
    try {
      addLog('Restoring UTEXOWallet from backup bytes...', 'info');
      const bytes = new Uint8Array(await backupFile.arrayBuffer());
      utexo.restoreFromBackupBytes(bytes, restorePassword);
      setRestoreOut(
        'Restore complete.\n⚠️ Updates in-memory state for the active wallet only.'
      );
      addLog('UTEXOWallet restore complete', 'ok');
    } catch (e) {
      setRestoreOut('Error: ' + e);
      addLog('Restore failed: ' + e, 'err');
    }
  }

  async function handleVssBackup() {
    if (!utexo) return setVssOut('Switch to a UTEXO wallet');
    if (!activeMnemonic) return setVssOut('Active wallet has no mnemonic');
    try {
      const config = buildVssConfig();
      addLog('Configuring VSS backup...', 'info');
      await utexo.configureVssBackup(config);
      addLog('VSS backup starting...', 'info');
      const version = await utexo.vssBackup(config);
      setVssOut(`VSS backup complete\nServer: ${vssUrl}\nStore: ${storeId}\nversion: ${version}`);
      addLog('UTEXOWallet VSS backup complete', 'ok');
    } catch (e) {
      setVssOut('Error: ' + e);
      addLog('VSS backup failed: ' + e, 'err');
    }
  }

  async function handleVssInfo() {
    if (!utexo) return setVssOut('Switch to a UTEXO wallet');
    try {
      const info = await utexo.vssBackupInfo(buildVssConfig());
      setVssOut(JSON.stringify(info, null, 2));
      addLog('VSS backup info fetched', 'ok');
    } catch (e) {
      setVssOut('Error: ' + e);
      addLog('VSS backup info failed: ' + e, 'err');
    }
  }

  return (
    <div>
      <h1 className="text-[#58a6ff] text-2xl font-bold mb-1">Backup & Restore — UTEXOWallet</h1>
      <p className="text-[#8b949e] text-sm mb-8">
        Encrypted file backup and VSS cloud backup for the RLN-backed UTEXOWallet.
      </p>

      <Section title="1. File Backup" hint="createBackup() then getLastBackupBytes() — a single encrypted blob.">
        {utexoWarn}
        <div className="flex gap-4 items-end flex-wrap">
          <Field label="Password">
            <input type="password" value={backupPwd} onChange={(e) => setBackupPwd(e.target.value)} className={inputCls} placeholder="Secure password" />
          </Field>
          <Btn onClick={handleBackup} disabled={!utexo} className="mb-4">Create Backup</Btn>
          <Btn
            variant="secondary"
            onClick={() => { if (lastBytes) { downloadBytes(lastBytes, 'utexo-wallet.backup'); addLog('backup downloaded', 'ok'); } }}
            disabled={!lastBytes}
            className="mb-4"
          >
            Download backup
          </Btn>
        </div>
        <OutputBox value={backupOut} />
      </Section>

      <Section title="2. File Restore" hint="restoreFromBackupBytes() — updates the active wallet's in-memory state.">
        {utexoWarn}
        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="Backup file">
            <input type="file" accept=".backup,*" onChange={(e) => setBackupFile(e.target.files?.[0] ?? null)} className={inputCls} />
          </Field>
          <Field label="Password">
            <input type="password" value={restorePassword} onChange={(e) => setRestorePassword(e.target.value)} className={inputCls} placeholder="Password used during backup" />
          </Field>
        </div>
        <Btn variant="danger" onClick={handleRestore} disabled={!utexo} className="mb-4">Restore from File</Btn>
        <OutputBox value={restoreOut} />
      </Section>

      <Section title="3. VSS Cloud Backup" hint="configureVssBackup() + vssBackup() / vssBackupInfo() — signing key derived from the wallet mnemonic.">
        {utexoWarn}
        <div className="flex gap-4 mb-2 flex-wrap">
          <Field label="VSS Server URL">
            <input value={vssUrl} onChange={(e) => setVssUrl(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Store ID">
            <input value={storeId} readOnly className={inputCls} />
          </Field>
        </div>
        <div className="flex gap-2 flex-wrap mb-2">
          <Btn onClick={handleVssBackup} disabled={!utexo}>VSS Backup</Btn>
          <Btn variant="secondary" onClick={handleVssInfo} disabled={!utexo}>VSS Backup Info</Btn>
        </div>
        <OutputBox value={vssOut} />
      </Section>
    </div>
  );
}
