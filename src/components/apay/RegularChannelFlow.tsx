// Regular Channel test — single-window flow: the native Faucet RLN (hub) opens
// a REGULAR (on-chain funded, non-virtual) RGB channel to the browser wasm
// node via REST /openchannel (with_anchors, asset 200 / push 100), then a
// 10-RGB payment is tested in each direction over that channel.
import { useStore } from '../../store';
import { Section } from '../Section';
import { Btn } from '../Btn';
import {
  CFG,
  FAUCET_API,
  FAUCET_LDK_PORT,
  KEYSEND_REPRO_ASSET_AMOUNT,
  PHASES_REGULAR,
  REGULAR_CHANNEL_ASSET_AMOUNT,
  REGULAR_CHANNEL_CAPACITY_SAT,
  REGULAR_CHANNEL_PUSH_ASSET_AMOUNT,
  REGULAR_PAY_ASSET_AMOUNT,
  REGULAR_PAYBACK_ASSET_AMOUNT,
  short,
} from './config';
import { useRegularChannelFlow } from './useRegularChannelFlow';
import { clearWalletsAndReload } from './useApayFlow';
import { PhaseRow } from './PhaseRow';
import { InfoCard } from './InfoCard';
import { LogPane } from './LogPane';

export function RegularChannelFlow() {
  const storeWallets = useStore((s) => s.wallets);
  const flow = useRegularChannelFlow();
  const hasOtherWallet = storeWallets.length > 0;

  return (
    <Section
      title="Regular Channel (hub → wasm, non-virtual)"
      hint="The native Faucet RLN acts as a routing hub: the wasm node dials it through the gateway relay, then the hub opens a REGULAR on-chain funded RGB channel via /openchannel (with_anchors, asset 200, push 100 — seeds RGB on both sides in one step). Once channel_ready on both sides, a payment is tested each way. Requires scripts/start-lsp-web.sh."
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
          <span className="text-[#8b949e]">payments:</span> {REGULAR_PAY_ASSET_AMOUNT} RGB wasm→hub,{' '}
          {REGULAR_PAYBACK_ASSET_AMOUNT} RGB back (asymmetric — visible after close)
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
          {flow.isRunning ? `Running… (${flow.phase})` : 'Run regular channel test'}
        </Btn>
        <Btn variant="secondary" onClick={flow.reset} disabled={flow.phase === 'idle'}>
          Reset
        </Btn>
        <Btn variant="secondary" onClick={flow.runKeysendOut} disabled={!flow.canRepro}>
          {flow.reproRunning ? 'Keysend running…' : 'Keysend wasm → hub (works)'}
        </Btn>
        <Btn variant="danger" onClick={flow.runKeysendRepro} disabled={!flow.canRepro}>
          {flow.reproRunning ? 'Keysend running…' : 'Keysend hub → wasm (force-close bug)'}
        </Btn>
        <Btn variant="primary" onClick={flow.runCloseChannel} disabled={!flow.canRepro}>
          {flow.closeRunning ? 'Closing…' : 'Close channel & settle on-chain'}
        </Btn>
      </div>
      <p className="text-xs text-[#8b949e] mb-3">
        Keysend tests (channel_issue.md), available after the flow completes — same channel, same
        amounts ({KEYSEND_REPRO_ASSET_AMOUNT} RGB), no invoice. wasm → hub settles normally;
        hub → wasm is expected to force-close the channel with «Invalid HTLC tx signature from
        peer» (run it last — it destroys the channel).
      </p>

      <PhaseRow phases={PHASES_REGULAR} phase={flow.phase} />

      {flow.channel && (
        <InfoCard
          title="Regular channel"
          accent="#58a6ff"
          rows={[
            ['channel id', short(flow.channel.channelId, 32)],
            ['capacity', `${flow.channel.capacitySat} sat`],
            ['wasm RGB', String(flow.channel.wasmRgb)],
            ['hub RGB', String(flow.channel.hubRgb)],
          ]}
        />
      )}
      {flow.payment && (
        <InfoCard
          title={`Payment (${flow.payment.direction})`}
          rows={[
            ['payment hash', flow.payment.paymentHash],
            ['status', flow.payment.status],
          ]}
        />
      )}

      {flow.repro && (
        <InfoCard
          title={`Keysend (${flow.repro.direction}, no invoice)`}
          accent="#d29922"
          rows={[
            ['payment hash', flow.repro.paymentHash],
            ['sender status', flow.repro.status],
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
                ? '✓ Keysend settled'
                : 'Keysend inconclusive'}
          </div>
          {flow.reproOutcome.detail}
        </div>
      )}

      {flow.onchain && (
        <InfoCard
          title="On-chain after close"
          accent="#3fb950"
          rows={[
            [
              'wasm settled',
              `${flow.onchain.wasmSettled} RGB (expected ${flow.onchain.wasmExpected})`,
            ],
            ['wasm spendable', String(flow.onchain.wasmSpendable)],
            [
              'hub spendable',
              `${flow.onchain.hubSpendable} RGB (expected +${flow.onchain.hubExpectedDelta})`,
            ],
          ]}
        />
      )}
      {flow.closeOutcome && (
        <div
          className="border rounded-lg p-4 mb-3 text-sm"
          style={
            flow.closeOutcome.kind === 'settled'
              ? { borderColor: '#3fb950', color: '#3fb950', backgroundColor: '#3fb95010' }
              : flow.closeOutcome.kind === 'partial'
                ? { borderColor: '#d29922', color: '#d29922', backgroundColor: '#d2992210' }
                : { borderColor: '#f85149', color: '#f85149', backgroundColor: '#f8514910' }
          }
        >
          <div className="font-bold mb-1">
            {flow.closeOutcome.kind === 'settled'
              ? '✓ Channel closed — split settled on-chain'
              : flow.closeOutcome.kind === 'partial'
                ? '⚠ Closed — hub settled on-chain; wasm sweep not implemented'
                : 'Close / on-chain settle incomplete'}
          </div>
          {flow.closeOutcome.detail}
        </div>
      )}

      {flow.verdict && (
        <div
          className="border rounded-lg p-4 mb-3 text-sm"
          style={
            flow.verdict.ok
              ? { borderColor: '#3fb950', color: '#3fb950', backgroundColor: '#3fb95010' }
              : { borderColor: '#f85149', color: '#f85149', backgroundColor: '#f8514910' }
          }
        >
          <div className="font-bold mb-1">
            {flow.verdict.ok ? '✓ Regular Channel Test Complete' : 'Regular channel test failed'}
          </div>
          {flow.verdict.detail}
        </div>
      )}
      {flow.errorMsg && <p className="text-[#f85149] text-sm mb-3">{flow.errorMsg}</p>}

      <LogPane entries={flow.log} />
    </Section>
  );
}
