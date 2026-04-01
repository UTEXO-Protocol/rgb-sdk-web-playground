import React, { useState, useRef, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { useStore } from '../store';
import type { SdkLogEntry } from '../store';
import { json } from '../lib/utils';
import { mineBlocks } from '../lib/utils';
import { saveSessions, setUrlWallet } from '../lib/session';

const navLinks = [
  { to: '/', label: 'Home' },
  { to: '/keys', label: 'Keys' },
  { to: '/wallet', label: 'Wallet' },
  { to: '/bitcoin', label: 'Bitcoin' },
  { to: '/rgb-assets', label: 'RGB Assets' },
  { to: '/utexo-wallet', label: 'UTXO Wallet' },
  { to: '/backup/manager', label: 'Backup MGR' },
  { to: '/backup/utexo', label: 'Backup UTXO' },
];

const statusStyles: Record<string, string> = {
  idle: 'bg-[#1c1f26] text-[#8b949e]',
  loading: 'bg-[#1c1f26] text-[#d29922]',
  ready: 'bg-[#0d2818] text-[#3fb950]',
  error: 'bg-[#2d1117] text-[#f85149]',
};

const logLevelCls: Record<string, string> = {
  ok: 'text-[#3fb950]',
  err: 'text-[#f85149]',
  warn: 'text-[#d29922]',
  info: 'text-[#8b949e]',
};

function SdkCallRow({ entry, expanded, onToggle }: { entry: SdkLogEntry; expanded: boolean; onToggle: () => void }) {
  return (
    <div className={`border-b border-[#21262d] last:border-0 ${entry.status === 'error' ? 'bg-[#2d1117]/40' : ''}`}>
      <button
        onClick={onToggle}
        className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-[#161b22]"
      >
        <span className={`shrink-0 w-2 h-2 rounded-full ${entry.status === 'ok' ? 'bg-[#3fb950]' : 'bg-[#f85149]'}`} />
        <span className="text-[#58a6ff] flex-1">{entry.method}</span>
        <span className="text-[#484f58]">{entry.durationMs}ms</span>
        <span className="text-[#484f58]">{entry.ts}</span>
        <span className="text-[#484f58]">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 space-y-1">
          <div>
            <span className="text-[#8b949e]">args: </span>
            <pre className="inline-block text-[#c9d1d9] whitespace-pre-wrap break-all">{json(entry.args)}</pre>
          </div>
          {entry.status === 'ok' && (
            <div>
              <span className="text-[#3fb950]">result: </span>
              <pre className="inline-block text-[#c9d1d9] whitespace-pre-wrap break-all">{json(entry.result)}</pre>
            </div>
          )}
          {entry.status === 'error' && (
            <div>
              <span className="text-[#f85149]">error: </span>
              <pre className="inline-block text-[#f85149] whitespace-pre-wrap break-all">{entry.error}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const sdkStatus = useStore((s) => s.sdkStatus);
  const sdkError = useStore((s) => s.sdkError);
  const log = useStore((s) => s.log);
  const clearLog = useStore((s) => s.clearLog);
  const addLog = useStore((s) => s.addLog);
  const wallets = useStore((s) => s.wallets);
  const activeWalletId = useStore((s) => s.activeWalletId);
  const setActiveWalletId = useStore((s) => s.setActiveWalletId);
  const removeWallet = useStore((s) => s.removeWallet);

  const sdkLog = useStore((s) => s.sdkLog);
  const clearSdkLog = useStore((s) => s.clearSdkLog);

  const [logOpen, setLogOpen] = useState(false);
  const [sdkLogOpen, setSdkLogOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [mineCount, setMineCount] = useState('1');
  const [mining, setMining] = useState(false);
  const sdkLogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (sdkLogOpen && sdkLogRef.current) {
      sdkLogRef.current.scrollTop = sdkLogRef.current.scrollHeight;
    }
  }, [sdkLog, sdkLogOpen]);

  const activeWallet = wallets.find((w) => w.id === activeWalletId) ?? null;
  const activeNetwork = (() => {
    try { return activeWallet?.instance.getNetwork() ?? null; } catch { return null; }
  })();
  const isRegtest = activeNetwork === 'regtest';

  async function handleMine() {
    const n = parseInt(mineCount) || 1;
    setMining(true);
    try {
      addLog('Mining ' + n + ' block(s)...', 'info');
      await mineBlocks(n);
      addLog('Mined ' + n + ' block(s)', 'ok');
    } catch (e) {
      addLog('Mine failed: ' + e, 'err');
    } finally {
      setMining(false);
    }
  }

  function handleRemoveActive() {
    if (!activeWallet) return;
    if (!window.confirm('Remove wallet "' + activeWallet.label + '"?')) return;
    removeWallet(activeWallet.id);
    const remaining = wallets.filter((w) => w.id !== activeWallet.id);
    saveSessions(remaining, remaining[remaining.length - 1]?.id ?? null);
    addLog('Wallet "' + activeWallet.label + '" removed', 'warn');
  }

  const statusLabel =
    sdkStatus === 'idle'
      ? 'SDK not initialized'
      : sdkStatus === 'loading'
      ? 'Initializing SDK...'
      : sdkStatus === 'ready'
      ? '@utexo/rgb-sdk-web ready'
      : 'SDK error: ' + sdkError;

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#c9d1d9]">
      <header className="border-b border-[#30363d] px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-6">
          <span className="text-[#58a6ff] font-bold text-lg whitespace-nowrap">RGB SDK Demo</span>
          <nav className="flex gap-4 flex-wrap">
            {navLinks.map((l) => (
              <NavLink
                key={l.to}
                to={{ pathname: l.to, search: activeWalletId ? `?wallet=${activeWalletId}` : '' }}
                end={l.to === '/'}
                className={({ isActive }) =>
                  'text-sm ' +
                  (isActive
                    ? 'text-[#58a6ff] font-bold border-b-2 border-[#58a6ff] pb-0.5'
                    : 'text-[#8b949e] hover:text-[#58a6ff]')
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Wallet switcher */}
          {wallets.length > 0 && (
            <div className="flex items-center gap-1">
              <select
                value={activeWalletId ?? ''}
                onChange={(e) => {
                  const id = e.target.value || null;
                  setActiveWalletId(id);
                  saveSessions(wallets, id);
                  setUrlWallet(id);
                }}
                className="text-xs px-2 py-1 bg-[#161b22] border border-[#30363d] rounded text-[#c9d1d9] max-w-[160px]"
              >
                {wallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label}
                  </option>
                ))}
              </select>
              <span className="text-xs text-[#484f58]">
                {activeWallet?.type === 'manager' ? 'MGR' : activeWallet?.type === 'utexo' ? 'UTXO' : ''}
              </span>
              <button
                onClick={handleRemoveActive}
                title="Remove active wallet"
                className="text-xs px-1.5 py-0.5 text-[#8b949e] hover:text-[#f85149] hover:bg-[#2d1117] rounded"
              >
                ×
              </button>
            </div>
          )}

          {/* Mine button (regtest only) */}
          {isRegtest && (
            <div className="flex items-center gap-1">
              <span className="text-xs text-[#d29922] px-2 py-0.5 rounded bg-[#2a1f00] border border-[#d29922]/30">
                regtest
              </span>
              <input
                type="number"
                value={mineCount}
                onChange={(e) => setMineCount(e.target.value)}
                className="w-12 text-xs px-1.5 py-1 bg-[#161b22] border border-[#30363d] rounded text-center text-[#c9d1d9]"
                min="1"
                max="100"
              />
              <button
                onClick={handleMine}
                disabled={mining}
                className="text-xs px-2 py-1 bg-[#d29922] hover:bg-[#e3b341] disabled:opacity-50 rounded text-black font-semibold"
              >
                {mining ? '⛏…' : '⛏ Mine'}
              </button>
            </div>
          )}

          <span className={`text-xs px-3 py-1 rounded-full whitespace-nowrap ${statusStyles[sdkStatus]}`}>
            {statusLabel}
          </span>
          <button
            onClick={() => setLogOpen((v) => !v)}
            className="text-xs px-2 py-1 bg-[#30363d] hover:bg-[#484f58] rounded text-[#c9d1d9]"
          >
            Log {log.length > 0 && `(${log.length})`}
          </button>
          <button
            onClick={() => setSdkLogOpen((v) => !v)}
            className={`text-xs px-2 py-1 rounded ${sdkLog.some(e => e.status === 'error') ? 'bg-[#2d1117] text-[#f85149] hover:bg-[#3d1f25]' : 'bg-[#30363d] text-[#c9d1d9] hover:bg-[#484f58]'}`}
          >
            SDK Calls {sdkLog.length > 0 && `(${sdkLog.length})`}
          </button>
        </div>
      </header>

      {logOpen && (
        <div className="border-b border-[#30363d] bg-[#161b22] px-6 py-3">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs text-[#8b949e] font-semibold">Activity Log</span>
            <button onClick={clearLog} className="text-xs text-[#8b949e] hover:text-[#f85149]">
              Clear
            </button>
          </div>
          <div className="bg-[#0d1117] border border-[#30363d] rounded p-3 max-h-48 overflow-y-auto font-mono text-xs leading-relaxed">
            {log.length === 0 ? (
              <span className="text-[#484f58]">No entries yet.</span>
            ) : (
              log.map((entry, i) => (
                <div key={i} className={logLevelCls[entry.level]}>
                  [{entry.ts}] {entry.msg}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {sdkLogOpen && (
        <div className="border-b border-[#30363d] bg-[#161b22] px-6 py-3">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs text-[#8b949e] font-semibold">SDK Calls</span>
            <button onClick={clearSdkLog} className="text-xs text-[#8b949e] hover:text-[#f85149]">Clear</button>
          </div>
          <div ref={sdkLogRef} className="bg-[#0d1117] border border-[#30363d] rounded max-h-72 overflow-y-auto font-mono text-xs">
            {sdkLog.length === 0 ? (
              <div className="p-3 text-[#484f58]">No calls yet.</div>
            ) : (
              sdkLog.map((entry) => (
                <SdkCallRow
                  key={entry.id}
                  entry={entry}
                  expanded={expandedId === entry.id}
                  onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                />
              ))
            )}
          </div>
        </div>
      )}

      <main className="max-w-4xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
