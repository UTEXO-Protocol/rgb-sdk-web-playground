// Faithful channel_issue.md repro flow: identical setup to RegularChannelFlow
// (hub /openchannel, with_anchors, asset 200 / push 100, regular funding), but
// the hub-initiated keysend fires as the FIRST HTLC on the virgin channel —
// no invoice payments warm up the commitment state beforehand. Expected per
// the report: the wasm side force-closes with «Invalid HTLC tx signature from
// peer» and the hub payment sticks at Pending.
import { useStore } from '../../store';
import { Section } from '../Section';
import { Btn } from '../Btn';
import {
  CFG,
  FAUCET_API,
  FAUCET_LDK_PORT,
  KEYSEND_REPRO_ASSET_AMOUNT,
  PHASES_KEYSEND_REPRO,
  REGULAR_CHANNEL_ASSET_AMOUNT,
  REGULAR_CHANNEL_CAPACITY_SAT,
  REGULAR_CHANNEL_PUSH_ASSET_AMOUNT,
  REGULAR_PAY_MSAT,
  short,
} from './config';
import { useRegularChannelFlow } from './useRegularChannelFlow';
import { clearWalletsAndReload } from './useApayFlow';
import { PhaseRow } from './PhaseRow';
import { InfoCard } from './InfoCard';
import { LogPane } from './LogPane';

export function KeysendReproFlow() {
  const storeWallets = useStore((s) => s.wallets);
  const flow = useRegularChannelFlow('keysend_repro');
  const hasOtherWallet = storeWallets.length > 0;

  return (
    <Section
      title="Keysend Bug Repro (first HTLC on a fresh channel)"
      hint="channel_issue.md, faithfully: same setup as the Regular Channel flow, but the hub keysend is the FIRST payment on the virgin channel — no invoice legs first. Run in a fresh tab (one wallet per tab). Requires scripts/start-lsp-web.sh."
    >
      {!flow.envReady && (
        <p className="text-[#f85149] text-sm mb-3">
          Not configured — run <code>./scripts/start-lsp-web.sh</code> (writes .env.local) and
          restart <code>npm run dev</code>.
        </p>
      )}
      {hasOtherWallet && (
        <div className="text-[#f85149] text-xs mb-3 flex items-center gap-2 flex-wrap">
          <span>
            This tab already initialized an RLN wallet (auto-restored on load). Only one wallet
            can exist per tab — clear it before running the flow.
          </span>
          <Btn variant="danger" onClick={clearWalletsAndReload}>
            Clear wallets &amp; reload
          </Btn>
        </div>
      )}

      <div className="bg-[#161b22] border border-[#30363d] rounded p-3 font-mono text-xs mb-4 space-y-0.5">
        <div>
          <span className="text-[#8b949e]">channel:</span> {REGULAR_CHANNEL_CAPACITY_SAT} sat,{' '}
          {REGULAR_CHANNEL_ASSET_AMOUNT} RGB (push {REGULAR_CHANNEL_PUSH_ASSET_AMOUNT}), anchors,
          regular funding
        </div>
        <div>
          <span className="text-[#8b949e]">keysend:</span> hub → wasm,{' '}
          {KEYSEND_REPRO_ASSET_AMOUNT} RGB @ {REGULAR_PAY_MSAT} msat — first HTLC, no invoice
        </div>
        <div>
          <span className="text-[#8b949e]">asset:</span> {CFG.assetId || '(unset)'}
        </div>
        <div>
          <span className="text-[#8b949e]">hub:</span> {FAUCET_API} (peer :{FAUCET_LDK_PORT})
        </div>
      </div>

      <div className="flex gap-2 mb-3 flex-wrap">
        <Btn
          variant="accent"
          onClick={flow.run}
          disabled={flow.isRunning || !flow.envReady || hasOtherWallet}
        >
          {flow.isRunning ? `Running… (${flow.phase})` : 'Run keysend repro'}
        </Btn>
        <Btn variant="secondary" onClick={flow.reset} disabled={flow.phase === 'idle'}>
          Reset
        </Btn>
      </div>

      <PhaseRow phases={PHASES_KEYSEND_REPRO} phase={flow.phase} />

      {flow.channel && (
        <InfoCard
          title="Fresh channel (no payments yet)"
          accent="#58a6ff"
          rows={[
            ['channel id', short(flow.channel.channelId, 32)],
            ['capacity', `${flow.channel.capacitySat} sat`],
            ['wasm RGB', String(flow.channel.wasmRgb)],
            ['hub RGB', String(flow.channel.hubRgb)],
          ]}
        />
      )}
      {flow.repro && (
        <InfoCard
          title="Keysend (hub→wasm, first HTLC)"
          accent="#d29922"
          rows={[
            ['payment hash', flow.repro.paymentHash],
            ['hub status', flow.repro.status],
          ]}
        />
      )}

      {flow.reproOutcome && (
        <div
          className="border rounded-lg p-4 mb-3 text-sm"
          style={
            flow.reproOutcome.kind === 'reproduced'
              ? { borderColor: '#d29922', color: '#d29922', backgroundColor: '#d2992210' }
              : flow.reproOutcome.kind === 'settled'
                ? { borderColor: '#3fb950', color: '#3fb950', backgroundColor: '#3fb95010' }
                : { borderColor: '#f85149', color: '#f85149', backgroundColor: '#f8514910' }
          }
        >
          <div className="font-bold mb-1">
            {flow.reproOutcome.kind === 'reproduced'
              ? '⚠ Force-close bug reproduced'
              : flow.reproOutcome.kind === 'settled'
                ? '✓ Keysend settled — bug not reproduced'
                : 'Keysend inconclusive'}
          </div>
          {flow.reproOutcome.detail}
        </div>
      )}
      {flow.errorMsg && <p className="text-[#f85149] text-sm mb-3">{flow.errorMsg}</p>}

      <LogPane entries={flow.log} />
    </Section>
  );
}
