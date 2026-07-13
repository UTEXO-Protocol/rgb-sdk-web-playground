// APay Cart Checkout · UTEXO (signet) — same guided two-window flow as the
// regtest ApayCartCheckout, but against the live signet stack (no mining;
// funding + settlement wait for real confirmations, so runs take ~10-30 min).
import { useState } from 'react';
import { useStore } from '../../../store';
import { Section } from '../../Section';
import { Field, inputCls } from '../../Field';
import { Btn } from '../../Btn';
import { PHASES_BUYER, PHASES_MERCHANT, short, type Role } from '../config';
import { clearWalletsAndReload } from '../useApayFlow';
import { PhaseRow } from '../PhaseRow';
import { InfoCard } from '../InfoCard';
import { LogPane } from '../LogPane';
import {
  CART_ITEM_SIGNET,
  FAUCET_CONFIGURED,
  PAYMENT_ASSET_AMOUNT,
  PAYMENT_MSAT,
  SIG,
} from './config';
import { useApaySignetFlow } from './useApaySignetFlow';

export function ApaySignetCheckout() {
  const storeWallets = useStore((s) => s.wallets);
  const [role, setRole] = useState<Role>('merchant');
  const flow = useApaySignetFlow(role);

  const hasOtherWallet = storeWallets.length > 0;
  const phases = role === 'merchant' ? PHASES_MERCHANT : PHASES_BUYER;

  return (
    <Section
      title="APay Cart Checkout · UTEXO signet (two windows)"
      hint="Same merchant + buyer checkout as the regtest flow, but on the live signet stack (network 'utexo', hosted LSP, faucet RLN node funds BTC and sends the RGB top-up). No mining — channel opens and settlements wait for real signet confirmations, expect ~10-30 min per side. Open this page in TWO windows: Run Merchant first, then Run Buyer."
    >
      {!flow.envReady && (
        <p className="text-[#f85149] text-sm mb-3">
          Not configured — set <code>VITE_SIGNET_FAUCET_URL</code>
          {SIG.lspBearerToken ? '' : ' (and VITE_SIGNET_LSP_BEARER for the APay routes)'} in{' '}
          <code>.env.local</code> and restart <code>npm run dev</code>.
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
          <span className="text-[#8b949e]">cart:</span> {CART_ITEM_SIGNET} —{' '}
          {PAYMENT_MSAT / 1000} sats + {PAYMENT_ASSET_AMOUNT} RGB
        </div>
        <div>
          <span className="text-[#8b949e]">asset:</span> {SIG.assetId || '(unset)'}
        </div>
        <div>
          <span className="text-[#8b949e]">lsp:</span> {SIG.lspBaseUrl} (peer auto-discovered)
        </div>
        <div>
          <span className="text-[#8b949e]">faucet:</span>{' '}
          {FAUCET_CONFIGURED ? 'configured (/faucet-signet proxy)' : '(unset)'}
        </div>
      </div>

      <div className="flex gap-2 mb-3 flex-wrap">
        <Btn
          variant={role === 'merchant' ? 'primary' : 'secondary'}
          onClick={() => setRole('merchant')}
          disabled={flow.isRunning}
        >
          Merchant
        </Btn>
        <Btn
          variant={role === 'buyer' ? 'primary' : 'secondary'}
          onClick={() => setRole('buyer')}
          disabled={flow.isRunning}
        >
          Buyer
        </Btn>
        <Btn
          variant="accent"
          onClick={flow.run}
          disabled={
            flow.isRunning ||
            !flow.envReady ||
            hasOtherWallet ||
            (role === 'buyer' && !flow.lightningAddress.trim())
          }
        >
          {flow.isRunning ? `Running… (${flow.phase})` : `Run ${role}`}
        </Btn>
        <Btn variant="secondary" onClick={flow.reset} disabled={flow.phase === 'idle'}>
          Reset
        </Btn>
      </div>

      {role === 'buyer' && (
        <Field
          label="Merchant Lightning Address (auto-filled from the Merchant window, or paste)"
          hint={
            flow.lightningAddress
              ? undefined
              : 'Run the Merchant window first — the address arrives automatically.'
          }
        >
          <input
            value={flow.lightningAddress}
            onChange={(e) => flow.setLightningAddress(e.target.value)}
            className={inputCls}
            placeholder="user@domain"
            disabled={flow.isRunning}
          />
        </Field>
      )}

      <PhaseRow phases={phases} phase={flow.phase} />

      {role === 'merchant' && flow.lightningAddress && (
        <InfoCard
          title="Lightning Address (published to the Buyer window)"
          accent="#58a6ff"
          rows={[
            ['address', flow.lightningAddress],
            ['unused hashes', String(flow.unusedHashes ?? '?')],
            ['channel RGB', String(flow.localRgb ?? '?')],
          ]}
        />
      )}
      {role === 'buyer' && flow.paymentHash && (
        <InfoCard
          title="Checkout payment"
          accent="#58a6ff"
          rows={[
            ['HODL invoice', short(flow.hodlBolt11, 40)],
            ['payment hash', flow.paymentHash],
            ['status', flow.sendStatus || 'Pending'],
            ['channel RGB', String(flow.localRgb ?? '?')],
          ]}
        />
      )}
      {flow.channel && (
        <InfoCard
          title="LSP channel"
          rows={[
            ['capacity', `${flow.channel.capacitySat} sat`],
            ['outbound', `${flow.channel.outboundBalanceMsat} msat`],
          ]}
        />
      )}
      {flow.otherStatus && (
        <InfoCard
          title={role === 'merchant' ? 'Buyer window' : 'Merchant window'}
          rows={[['status', flow.otherStatus]]}
        />
      )}

      {flow.checkout && (
        <div
          className="border rounded-lg p-4 mb-3 text-sm"
          style={
            flow.checkout.ok
              ? { borderColor: '#3fb950', color: '#3fb950', backgroundColor: '#3fb95010' }
              : flow.checkout.soft
                ? { borderColor: '#d29922', color: '#d29922', backgroundColor: '#d2992210' }
                : { borderColor: '#f85149', color: '#f85149', backgroundColor: '#f8514910' }
          }
        >
          <div className="font-bold mb-1">
            {flow.checkout.ok
              ? '✓ Cart Checkout Complete'
              : flow.checkout.soft
                ? 'Checkout paid — merchant delivery pending'
                : 'Checkout failed'}
          </div>
          {flow.checkout.detail}
        </div>
      )}
      {flow.errorMsg && <p className="text-[#f85149] text-sm mb-3">{flow.errorMsg}</p>}

      <LogPane entries={flow.log} />
    </Section>
  );
}
