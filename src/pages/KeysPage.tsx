import React, { useState } from 'react';
import {
  generateKeys,
  restoreKeys,
  deriveKeysFromMnemonic,
  bip39,
} from '@utexo/rgb-sdk-web';
import { useStore } from '../store';
import { Section } from '../components/Section';
import { Field, inputCls, selectCls, textareaCls } from '../components/Field';
import { Btn } from '../components/Btn';
import { OutputBox } from '../components/OutputBox';
import { json } from '../lib/utils';

export function KeysPage() {
  const addLog = useStore((s) => s.addLog);

  const [network, setNetwork] = useState('signet');
  const [mnemonic, setMnemonic] = useState('');
  const [keysOut, setKeysOut] = useState('');
  const [deriveOut, setDeriveOut] = useState('');
  const [validateOut, setValidateOut] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    try {
      addLog('Generating keys for ' + network + '...', 'info');
      const keys = await generateKeys(network);
      setMnemonic(keys.mnemonic);
      setKeysOut(json(keys));
      addLog('Keys generated', 'ok');
    } catch (e) {
      setKeysOut('Error: ' + e);
      addLog('Generate failed: ' + e, 'err');
    } finally {
      setLoading(false);
    }
  }

  async function handleRestore() {
    if (!mnemonic.trim()) { setKeysOut('Enter a mnemonic first'); return; }
    setLoading(true);
    try {
      addLog('Restoring keys...', 'info');
      const keys = await restoreKeys(network, mnemonic.trim());
      setKeysOut(json(keys));
      addLog('Keys restored', 'ok');
    } catch (e) {
      setKeysOut('Error: ' + e);
      addLog('Restore failed: ' + e, 'err');
    } finally {
      setLoading(false);
    }
  }

  async function handleDerive() {
    if (!mnemonic.trim()) { setDeriveOut('Enter a mnemonic first'); return; }
    setLoading(true);
    try {
      addLog('Deriving keys from mnemonic...', 'info');
      const keys = await deriveKeysFromMnemonic(network, mnemonic.trim());
      setDeriveOut(json(keys));
      addLog('Keys derived', 'ok');
    } catch (e) {
      setDeriveOut('Error: ' + e);
      addLog('Derive failed: ' + e, 'err');
    } finally {
      setLoading(false);
    }
  }

  function handleValidate() {
    if (!mnemonic.trim()) { setValidateOut('Enter a mnemonic first'); return; }
    try {
      const valid = bip39.validateMnemonic(mnemonic.trim());
      setValidateOut(valid ? 'Valid mnemonic' : 'Invalid mnemonic');
      addLog('Mnemonic validation: ' + (valid ? 'valid' : 'invalid'), valid ? 'ok' : 'warn');
    } catch (e) {
      setValidateOut('Error: ' + e);
    }
  }

  return (
    <div>
      <h1 className="text-[#58a6ff] text-2xl font-bold mb-1">Keys</h1>
      <p className="text-[#8b949e] text-sm mb-6">
        generateKeys, restoreKeys, deriveKeysFromMnemonic, bip39
      </p>

      <Section title="1. Generate / Restore Keys">
        <div className="flex gap-4 mb-4 flex-wrap">
          <Field label="Network">
            <select value={network} onChange={(e) => setNetwork(e.target.value)} className={selectCls}>
              <option value="signet">signet</option>
              <option value="testnet">testnet</option>
              <option value="regtest">regtest</option>
              <option value="mainnet">mainnet</option>
            </select>
          </Field>
        </div>
        <Field label="Mnemonic (leave blank to generate new)">
          <textarea
            value={mnemonic}
            onChange={(e) => setMnemonic(e.target.value)}
            className={textareaCls}
            rows={2}
            placeholder="word1 word2 word3 ... (12 or 24 words)"
          />
        </Field>
        <div className="flex gap-2 flex-wrap">
          <Btn onClick={handleGenerate} disabled={loading}>Generate Keys</Btn>
          <Btn variant="secondary" onClick={handleRestore} disabled={loading}>Restore Keys</Btn>
        </div>
        <OutputBox label="Keys" value={keysOut} />
      </Section>

      <Section title="2. Derive Keys from Mnemonic">
        <p className="text-sm text-[#8b949e] mb-4">
          Uses the mnemonic entered above. Shows xpubs + fingerprint.
        </p>
        <Btn onClick={handleDerive} disabled={loading}>Derive Keys</Btn>
        <OutputBox label="Derived Keys" value={deriveOut} />
      </Section>

      <Section title="3. Validate Mnemonic (bip39)">
        <p className="text-sm text-[#8b949e] mb-4">
          Validates the mnemonic entered above using bip39.
        </p>
        <Btn variant="secondary" onClick={handleValidate} disabled={loading}>Validate Mnemonic</Btn>
        <OutputBox label="Validation Result" value={validateOut} />
      </Section>
    </div>
  );
}
