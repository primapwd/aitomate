import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { vault, type VaultStatus } from '@/lib/vault';
import { getLlmSettings, setLlmSettings } from '@/lib/runner/llm/settings';
import type { VaultCommand, VaultResponse } from '@/lib/vault/messages';

// ── Shared inline styles (consistent with AppShell) ──

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  border: '1px solid #ccc',
  borderRadius: 6,
  fontSize: 13,
  boxSizing: 'border-box',
  marginTop: 4,
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: '#444',
  marginTop: 12,
};

const sectionBox: React.CSSProperties = {
  marginBottom: 16,
  padding: 12,
  background: '#f5f5f5',
  borderRadius: 8,
};

const btnBase: React.CSSProperties = {
  padding: '6px 16px',
  border: 'none',
  borderRadius: 6,
  fontSize: 13,
  cursor: 'pointer',
  fontWeight: 600,
};

const primaryBtn: React.CSSProperties = { ...btnBase, background: '#1a1a1a', color: '#fff' };
const secondaryBtn: React.CSSProperties = { ...btnBase, background: '#e5e5e5', color: '#333' };
const dangerBtn: React.CSSProperties = { ...btnBase, background: '#ffebee', color: '#d32f2f' };

function statusColor(s: VaultStatus | 'loading'): string {
  if (s === 'unlocked') return '#2e7d32';
  if (s === 'locked') return '#f57c00';
  return '#777';
}

function statusLabel(s: VaultStatus | 'loading'): string {
  if (s === 'loading') return '…';
  return s;
}

async function sendVaultCommand(cmd: VaultCommand): Promise<VaultResponse> {
  try {
    return await browser.runtime.sendMessage(cmd) as VaultResponse;
  } catch {
    return { ok: false, error: 'Could not reach the background service worker.' };
  }
}

export default function SettingsView() {
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | 'loading'>('loading');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Vault form state
  const [passphrase, setPassphrase] = useState('');
  const [newPassphrase, setNewPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');

  // LLM config
  const [provider, setProvider] = useState<'openai' | 'anthropic'>('openai');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [reasoningEffort, setReasoningEffort] = useState<'' | 'low' | 'medium' | 'high'>('');

  const loadAll = useCallback(async () => {
    setError(null);
    const status = await vault.getStatus();
    setVaultStatus(status);

    const llmSettings = await getLlmSettings();
    setProvider(llmSettings.provider);
    setBaseUrl(llmSettings.baseUrl);
    setModel(llmSettings.model);
    setReasoningEffort(llmSettings.reasoningEffort ?? '');

    if (status === 'unlocked') {
      const secret = await vault.getEntry<{ apiKey: string }>('llm-provider', 'default');
      if (secret?.apiKey) setApiKey(secret.apiKey);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function handleInitialize() {
    if (newPassphrase !== confirmPassphrase) {
      setError('Passphrases do not match.');
      return;
    }
    if (newPassphrase.length < 8) {
      setError('Passphrase must be at least 8 characters.');
      return;
    }
    setError(null);
    setSuccess(null);

    try {
      await vault.initialize(newPassphrase);
    } catch (err) {
      setError((err as Error).message);
      return;
    }

    const bg = await sendVaultCommand({ type: 'aitomate:vault:initialize', passphrase: newPassphrase });
    if (!bg.ok) {
      setError(`Vault created locally, but background sync failed: ${bg.error ?? 'unknown error'}`);
      return;
    }

    setVaultStatus('unlocked');
    setNewPassphrase('');
    setConfirmPassphrase('');
    setSuccess('Vault created and unlocked.');
  }

  async function handleUnlock() {
    setError(null);
    setSuccess(null);

    try {
      await vault.unlock(passphrase);
    } catch (err) {
      setError((err as Error).message);
      return;
    }

    const bg = await sendVaultCommand({ type: 'aitomate:vault:unlock', passphrase });
    if (!bg.ok) {
      setError(`Unlocked locally, but background sync failed: ${bg.error ?? 'unknown error'}`);
      return;
    }

    setVaultStatus('unlocked');
    setPassphrase('');

    const secret = await vault.getEntry<{ apiKey: string }>('llm-provider', 'default');
    if (secret?.apiKey) setApiKey(secret.apiKey);

    setSuccess('Vault unlocked.');
  }

  async function handleLock() {
    vault.lock();
    void sendVaultCommand({ type: 'aitomate:vault:lock' });
    setVaultStatus('locked');
    setApiKey('');
  }

  async function handleReset() {
    setError(null);
    setSuccess(null);

    try {
      await vault.reset();
    } catch (err) {
      setError((err as Error).message);
      return;
    }

    const bg = await sendVaultCommand({ type: 'aitomate:vault:reset' });
    if (!bg.ok) {
      setError(`Vault reset locally, but background sync failed: ${bg.error ?? 'unknown error'}`);
      return;
    }

    setVaultStatus('uninitialized');
    setApiKey('');
    setSuccess('Vault has been reset.');
  }

  async function handleSave() {
    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      await setLlmSettings({
        provider,
        baseUrl,
        model,
        reasoningEffort: reasoningEffort || undefined,
      });

      if (apiKey) {
        if (vaultStatus !== 'unlocked') {
          setError('Unlock the vault first to save the API key.');
          setSaving(false);
          return;
        }
        await vault.setEntry('llm-provider', 'default', { apiKey });
      }

      setSuccess('Settings saved.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <h2 style={{ fontSize: 16, margin: '0 0 8px', fontWeight: 600 }}>Settings</h2>

      {error && (
        <p style={{ fontSize: 12, color: '#d32f2f', background: '#ffebee', padding: '6px 10px', borderRadius: 6 }}>
          {error}
        </p>
      )}
      {success && (
        <p style={{ fontSize: 12, color: '#2e7d32', background: '#e8f5e9', padding: '6px 10px', borderRadius: 6 }}>
          {success}
        </p>
      )}

      {/* ── Vault section ── */}
      <div style={sectionBox}>
        <h3 style={{ fontSize: 13, margin: '0 0 8px', fontWeight: 600 }}>
          Secure Vault
          <span style={{ marginLeft: 8, fontSize: 11, color: statusColor(vaultStatus) }}>
            ({statusLabel(vaultStatus)})
          </span>
        </h3>

        {vaultStatus === 'uninitialized' && (
          <>
            <p style={{ fontSize: 12, color: '#555', margin: '0 0 8px' }}>
              Set a passphrase to create an encrypted vault for your API keys.
            </p>
            <label style={labelStyle}>
              New passphrase
              <input
                type="password"
                value={newPassphrase}
                onChange={(e) => setNewPassphrase(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Confirm passphrase
              <input
                type="password"
                value={confirmPassphrase}
                onChange={(e) => setConfirmPassphrase(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleInitialize()}
                style={inputStyle}
              />
            </label>
            <button onClick={handleInitialize} style={{ ...primaryBtn, marginTop: 12 }}>
              Create vault
            </button>
          </>
        )}

        {vaultStatus === 'locked' && (
          <>
            <p style={{ fontSize: 12, color: '#555', margin: '0 0 8px' }}>
              Enter your passphrase to unlock the vault.
            </p>
            <label style={labelStyle}>
              Passphrase
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
                style={inputStyle}
              />
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={handleUnlock} style={primaryBtn}>Unlock</button>
              <button onClick={handleReset} style={dangerBtn}>Reset vault</button>
            </div>
          </>
        )}

        {vaultStatus === 'unlocked' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: '#2e7d32' }}>Unlocked.</span>
            <button onClick={handleLock} style={{ ...secondaryBtn, padding: '2px 8px', fontSize: 11 }}>
              Lock
            </button>
            <button onClick={handleReset} style={{ ...dangerBtn, padding: '2px 8px', fontSize: 11 }}>
              Reset
            </button>
          </div>
        )}
      </div>

      {/* ── AI Provider section ── */}
      <h3 style={{ fontSize: 13, margin: '0 0 8px', fontWeight: 600 }}>AI Provider</h3>

      <label style={labelStyle}>
        Provider
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as 'openai' | 'anthropic')}
          style={inputStyle}
        >
          <option value="openai">OpenAI-compatible</option>
          <option value="anthropic">Anthropic</option>
        </select>
      </label>

      <label style={labelStyle}>
        Base URL
        <input
          type="url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com/v1'}
          style={inputStyle}
        />
      </label>

      <label style={labelStyle}>
        Model
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={provider === 'openai' ? 'gpt-4o-mini' : 'claude-sonnet-4-20250514'}
          style={inputStyle}
        />
      </label>

      <label style={labelStyle}>
        Reasoning effort
        <select
          value={reasoningEffort}
          onChange={(e) => setReasoningEffort(e.target.value as '' | 'low' | 'medium' | 'high')}
          style={inputStyle}
        >
          <option value="">Off</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </label>

      {vaultStatus === 'unlocked' ? (
        <label style={labelStyle}>
          API Key
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-…"
            style={inputStyle}
          />
        </label>
      ) : (
        <p style={{ fontSize: 12, color: '#f57c00', marginTop: 12 }}>
          Unlock the vault above to set an API key.
        </p>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        style={{ ...primaryBtn, marginTop: 16, opacity: saving ? 0.6 : 1 }}
      >
        {saving ? 'Saving…' : 'Save settings'}
      </button>
    </section>
  );
}
