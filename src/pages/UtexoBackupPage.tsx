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

  // ── VSS restore & fence (RN-parity flow) ──────────────────────────────────
  const [fenceOut, setFenceOut] = useState('');

  async function handleLdkVssHealth() {
    if (!utexo) return setFenceOut('Switch to a UTEXO wallet');
    try {
      const info = utexo.ldkVssBackupInfo();
      if (!info) return setFenceOut('No Lightning node on this wallet (no proxyUrl/transportEndpoint)');
      const fenceHeld = !info.configured && /owned by another/.test(info.lastError ?? '');
      setFenceOut(
        JSON.stringify(info, null, 2) +
          (fenceHeld ? '\n\n⚠️ Fence held by another instance — if that device is gone for good: Disable Replication → Clear Fence → Unlock.' : '')
      );
      addLog('LDK VSS health fetched', 'ok');
    } catch (e) {
      setFenceOut('Error: ' + e);
      addLog('LDK VSS health failed: ' + e, 'err');
    }
  }

  function handleDisableReplication() {
    if (!utexo) return setFenceOut('Switch to a UTEXO wallet');
    if (!window.confirm('Stop VSS channel replication and release the fence?\n\nChannel state stays local, but new channel updates will NOT reach the cloud until you Unlock again (which re-enables replication).')) return;
    try {
      utexo.disableLdkVssReplication();
      setFenceOut('Replication disabled — replicator stopped, fence + Web Lock released.\nTakeover test on a live wallet: Disable → Clear Fence → Unlock.');
      addLog('LDK VSS replication disabled', 'ok');
    } catch (e) {
      setFenceOut('Error: ' + e);
      addLog('disableLdkVssReplication failed: ' + e, 'err');
    }
  }

  async function handleClearFence() {
    if (!utexo) return setFenceOut('Switch to a UTEXO wallet');
    if (!window.confirm('Clear the VSS single-writer fence?\n\nOnly do this if the previous device/profile is GONE FOR GOOD — clearing while it is still running puts two writers on one channel store (fund-loss risk).')) return;
    try {
      addLog('Clearing LDK VSS fence...', 'info');
      await utexo.vssClearFence(); // identity derived at init(); RN-parity alias of clearLdkVssFence()
      setFenceOut('Fence cleared. Now press Unlock — it re-attempts configureLdkVssReplication and, on a fresh device, restores channel state.');
      addLog('LDK VSS fence cleared', 'ok');
    } catch (e) {
      setFenceOut('Error: ' + e);
      addLog('Clear fence failed: ' + e, 'err');
    }
  }

  async function handleUnlock() {
    if (!utexo) return setFenceOut('Switch to a UTEXO wallet');
    try {
      addLog('unlock(): LDK VSS configure (guarded channel restore) + go-online...', 'info');
      await utexo.unlock(); // runs once; re-run requires Disable Replication first
      const info = utexo.ldkVssBackupInfo();
      setFenceOut('unlock() done\nLDK VSS health: ' + JSON.stringify(info, null, 2));
      addLog('unlock() complete', 'ok');
    } catch (e) {
      setFenceOut('Error: ' + e);
      addLog('unlock() failed: ' + e, 'err');
    }
  }

  async function handleVssRestore() {
    if (!utexo) return setFenceOut('Switch to a UTEXO wallet');
    if (!window.confirm('Low-level: force-restore the wallet stream (RGB assets, stock, BDK state) from VSS?\n\nOverwrites local wallet state with the cloud snapshot — prefer restoreFromVss() in the locked gap.')) return;
    try {
      addLog('vssRestoreBackup(): restoring wallet stream from VSS...', 'info');
      await utexo.vssRestoreBackup(); // uses the identity configured at init()
      setFenceOut('Wallet-stream restore complete — assets/UTXOs reloaded from the cloud snapshot.');
      addLog('VSS wallet-stream restore complete', 'ok');
    } catch (e) {
      setFenceOut('Error: ' + e);
      addLog('VSS restore failed: ' + e, 'err');
    }
  }

  // Explicit one-call restore — run in the locked gap (init done, before
  // unlock): wallet stream restores now, channels at the Unlock that follows.
  // Fence takeover is the DEFAULT; takeoverFence: false keeps the old fence.
  async function handleRlnRestore(takeoverFence: boolean) {
    if (!utexo) return setFenceOut('Switch to a UTEXO wallet');
    const msg = takeoverFence
      ? 'Restore this wallet from VSS?\n\nOverwrites local wallet state with the cloud snapshot AND takes over the channel-stream fence (default) — only if the previous device/profile is GONE FOR GOOD; two live writers on one channel store risk fund loss.'
      : 'Restore from VSS WITHOUT taking the fence?\n\nWallet stream restores from the cloud; the channel stream stays with the old device until it releases its fence.';
    if (!window.confirm(msg)) return;
    try {
      addLog('restoreFromVss(): explicit restore' + (takeoverFence ? ' (+ fence takeover, default)' : ' (fence kept)') + '...', 'info');
      const res = await utexo.restoreFromVss(takeoverFence ? undefined : { takeoverFence: false });
      setFenceOut('restoreFromVss() done\n' + JSON.stringify(res, null, 2) + '\n\nNow press Unlock — channel state restores there (guarded), then the wallet goes online.');
      addLog('restoreFromVss complete (walletRestored=' + res.walletRestored + ')', 'ok');
    } catch (e) {
      setFenceOut('Error: ' + e);
      addLog('restoreFromVss failed: ' + e, 'err');
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

      <Section
        title="4. VSS Restore & Fence"
        hint="Fresh-device restore test: wipe the profile, re-create the wallet with the same mnemonic (init only — locked), press Restore from VSS (takes over the old fence by default), then Unlock. Restore is explicit — plain Unlock starts fresh and warns if a cloud backup exists. Already unlocked? Disable Replication first — unlock runs once."
      >
        {utexoWarn}
        <div className="flex gap-2 flex-wrap mb-2">
          <Btn onClick={() => handleRlnRestore(true)} disabled={!utexo}>Restore from VSS (restoreFromVss)</Btn>
          <Btn variant="secondary" onClick={() => handleRlnRestore(false)} disabled={!utexo}>Restore (keep fence)</Btn>
          <Btn variant="secondary" onClick={handleLdkVssHealth} disabled={!utexo}>LDK VSS Health</Btn>
          <Btn variant="secondary" onClick={handleDisableReplication} disabled={!utexo}>Disable Replication</Btn>
          <Btn variant="danger" onClick={handleClearFence} disabled={!utexo}>Clear Fence (vssClearFence)</Btn>
          <Btn onClick={handleUnlock} disabled={!utexo}>Unlock (retry)</Btn>
          <Btn variant="danger" onClick={handleVssRestore} disabled={!utexo}>VSS Restore (low-level, wallet stream)</Btn>
        </div>
        <OutputBox value={fenceOut} />
      </Section>
    </div>
  );
}
