import React from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store';

const cards = [
  {
    to: '/keys',
    title: 'Keys',
    desc: 'Generate keys, restore from mnemonic, derive extended keys, validate with bip39',
  },
  {
    to: '/wallet',
    title: 'Wallet',
    desc: 'Create WalletManager or UTEXOWallet instances — switch between multiple wallets, view config params',
  },
  {
    to: '/bitcoin',
    title: 'Bitcoin',
    desc: 'Send BTC with explicit PSBT signing, faucet funding, fee estimation',
  },
  {
    to: '/rgb-assets',
    title: 'RGB Assets',
    desc: 'Issue NIA/IFA, create receive invoices, send assets with PSBT flow',
  },
  {
    to: '/backup',
    title: 'Backup & Restore',
    desc: 'File backup (bytes), UTEXOWallet dual backup, VSS cloud backup/restore',
  },
];

export function HomePage() {
  const sdkStatus = useStore((s) => s.sdkStatus);
  const wallets = useStore((s) => s.wallets);
  const activeWalletId = useStore((s) => s.activeWalletId);
  const activeWallet = wallets.find((w) => w.id === activeWalletId) ?? null;

  return (
    <div>
      <h1 className="text-[#58a6ff] text-3xl font-bold mb-2">RGB SDK Web Demo</h1>
      <p className="text-[#8b949e] mb-8">
        Interactive demo of all <code className="text-[#c9d1d9]">@utexo/rgb-sdk-web</code> functions.
      </p>

      {/* Status */}
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4 mb-6 flex flex-wrap gap-6">
        <div>
          <span className="text-xs text-[#8b949e] block mb-1">SDK Status</span>
          <span className={`text-sm font-semibold ${sdkStatus === 'ready' ? 'text-[#3fb950]' : sdkStatus === 'error' ? 'text-[#f85149]' : 'text-[#d29922]'}`}>
            {sdkStatus}
          </span>
        </div>
        <div>
          <span className="text-xs text-[#8b949e] block mb-1">Wallets</span>
          <span className={`text-sm font-semibold ${wallets.length > 0 ? 'text-[#3fb950]' : 'text-[#484f58]'}`}>
            {wallets.length > 0 ? wallets.length + ' wallet(s)' : 'none'}
          </span>
        </div>
        {activeWallet && (
          <div>
            <span className="text-xs text-[#8b949e] block mb-1">Active</span>
            <span className="text-sm font-semibold text-[#58a6ff]">
              {activeWallet.label} <span className="text-[#8b949e] font-normal">({activeWallet.config.network})</span>
            </span>
          </div>
        )}
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cards.map((card) => (
          <Link
            key={card.to}
            to={card.to}
            className="bg-[#161b22] border border-[#30363d] rounded-lg p-5 hover:border-[#58a6ff] transition-colors"
          >
            <h2 className="text-[#58a6ff] font-semibold text-lg mb-2">{card.title}</h2>
            <p className="text-sm text-[#8b949e]">{card.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
