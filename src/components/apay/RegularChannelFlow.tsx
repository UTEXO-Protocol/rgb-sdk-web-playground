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
        <Btn variant="danger" onClick={flow.runWalletFundedOpen} disabled={!flow.canFund}>
          {flow.fundingRunning
            ? 'Funding…'
            : `Wallet-funded open (${flow.fundWarm ? 'warm' : 'COLD'})`}
        </Btn>
      </div>
      <p className="text-xs text-[#8b949e] mb-3">
        <b>Wallet-funded open</b> inverts the topology: the <i>wasm</i> node opens a channel to{' '}
        <code>regular_web</code> (the daemon without <code>--enable-virtual-channels-v0</code>, the
        only peer that accepts a browser-initiated open) and the app funds it itself via
        buildLightningFundingTx → submitFundingTransaction. Known to stall at «pending awaiting
        funding lock-in». When the funding tx never reaches the indexer, the run POSTs the identical
        hex to esplora directly — if esplora accepts it the tx was always valid and our broadcast
        path is the bug; if esplora rejects it, the tx itself is wrong.
        {' '}
        <b>COLD vs warm is the experiment:</b> clicked first in a fresh tab it bootstraps its own
        wallet (create → fund → sync, no createUtxos, no payments) and opens immediately; clicked
        after the main flow the BDK view is warm. If cold fails and warm passes, stale-view input
        selection (§6.0l) is confirmed.
      </p>
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
              : { borderColor: '#f85149', color: '#f85149', backgroundColor: '#f8514910' }
          }
        >
          <div className="font-bold mb-1">
            {flow.closeOutcome.kind === 'settled'
              ? '✓ Channel closed — split settled on-chain (both sides)'
              : flow.closeOutcome.kind === 'partial'
                ? '✗ Only the hub settled — the wasm post-close sweep did not land'
                : 'Close / on-chain settle incomplete'}
          </div>
          {flow.closeOutcome.detail}
        </div>
      )}

      {flow.funding && (
        <InfoCard
          title="Wallet-funded open (wasm → regular_web)"
          accent="#d29922"
          rows={[
            ['temporary channel id', short(flow.funding.temporaryChannelId, 32)],
            ['capacity', `${flow.funding.channelValueSat} sat`],
            ['funding txid', flow.funding.txid],
            [
              'SDK broadcast',
              flow.funding.sdkBroadcast === null
                ? 'checking…'
                : flow.funding.sdkBroadcast
                  ? 'indexer saw it ✓'
                  : 'indexer never saw it ✗',
            ],
            ...(flow.funding.probe
              ? [['esplora POST /tx', flow.funding.probe] as [string, string]]
              : []),
          ]}
        />
      )}
      {flow.fundingOutcome && (
        <div
          className="border rounded-lg p-4 mb-3 text-sm"
          style={
            flow.fundingOutcome.kind === 'ready'
              ? { borderColor: '#3fb950', color: '#3fb950', backgroundColor: '#3fb95010' }
              : flow.fundingOutcome.kind === 'inconclusive'
                ? { borderColor: '#8b949e', color: '#8b949e', backgroundColor: '#8b949e10' }
                : { borderColor: '#f85149', color: '#f85149', backgroundColor: '#f8514910' }
          }
        >
          <div className="font-bold mb-1">
            {flow.fundingOutcome.kind === 'ready'
              ? '✓ Wallet-funded channel ready'
              : flow.fundingOutcome.kind === 'broadcast_broken'
                ? '✗ SDK broadcast path is the bug (tx was valid)'
                : flow.fundingOutcome.kind === 'tx_invalid'
                  ? '✗ Funding transaction itself is invalid'
                  : flow.fundingOutcome.kind === 'stalled'
                    ? '✗ Tx published, channel never locked in'
                    : 'Wallet-funded open inconclusive'}
          </div>
          {flow.fundingOutcome.detail}
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
