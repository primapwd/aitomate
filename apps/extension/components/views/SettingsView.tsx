import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { vault, type VaultStatus } from '@/lib/vault';
import { getLlmSettings, setLlmSettings } from '@/lib/runner/llm/settings';
import { isDebugEnabled, setDebugEnabled } from '@/lib/debug';
import type { VaultCommand, VaultResponse } from '@/lib/vault/messages';
import {
  IconAlert,
  IconCheck,
  IconEye,
  IconEyeOff,
  IconLock,
  IconSave,
  IconShield,
  IconUnlock,
  IconWand,
  IconZap,
} from '@/components/ui/icons';

async function sendVaultCommand(cmd: VaultCommand): Promise<VaultResponse> {
  try {
    return (await browser.runtime.sendMessage(cmd)) as VaultResponse;
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
  const [showApiKey, setShowApiKey] = useState(false);

  // Debug
  const [debugEnabled, setDebugEnabled_] = useState(false);

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

    setDebugEnabled_(await isDebugEnabled());

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
      {error && (
        <div
          style={{
            padding: '8px 12px',
            background: 'var(--status-error-bg)',
            border: '1px solid var(--status-error-border)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--status-error)',
            fontSize: 11,
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <IconAlert size={14} color="var(--status-error)" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div
          style={{
            padding: '8px 12px',
            background: 'var(--status-success-bg)',
            border: '1px solid var(--status-success-border)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--status-success)',
            fontSize: 11,
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <IconCheck size={14} color="var(--status-success)" />
          <span>{success}</span>
        </div>
      )}

      {/* ── Vault section ── */}
      <div className="ait-card" style={{ background: 'var(--bg-surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <IconShield size={16} color="var(--accent-primary)" />
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>Encrypted Vault</span>
          </div>

          <span
            className={`ait-badge ${
              vaultStatus === 'unlocked'
                ? 'ait-badge-success'
                : vaultStatus === 'locked'
                  ? 'ait-badge-warning'
                  : 'ait-badge-muted'
            }`}
          >
            {vaultStatus === 'unlocked' ? (
              <>
                <IconUnlock size={10} /> Unlocked
              </>
            ) : vaultStatus === 'locked' ? (
              <>
                <IconLock size={10} /> Locked
              </>
            ) : (
              'Uninitialized'
            )}
          </span>
        </div>

        {vaultStatus === 'uninitialized' && (
          <div style={{ marginTop: 8 }}>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 8px' }}>
              Create an AES-256 encrypted vault to securely store your LLM API keys on your machine.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input
                type="password"
                value={newPassphrase}
                onChange={(e) => setNewPassphrase(e.target.value)}
                placeholder="New vault passphrase (min 8 chars)"
                className="ait-input"
              />
              <input
                type="password"
                value={confirmPassphrase}
                onChange={(e) => setConfirmPassphrase(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleInitialize()}
                placeholder="Confirm passphrase"
                className="ait-input"
              />
              <button
                onClick={handleInitialize}
                className="ait-btn ait-btn-primary ait-btn-sm"
                style={{ marginTop: 4 }}
              >
                <IconShield size={12} />
                <span>Initialize Vault</span>
              </button>
            </div>
          </div>
        )}

        {vaultStatus === 'locked' && (
          <div style={{ marginTop: 8 }}>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 8px' }}>
              Enter your master passphrase to unlock API key access.
            </p>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
                placeholder="Passphrase"
                className="ait-input"
                style={{ flex: 1 }}
              />
              <button onClick={handleUnlock} className="ait-btn ait-btn-primary ait-btn-sm">
                Unlock
              </button>
              <button onClick={handleReset} className="ait-btn ait-btn-danger ait-btn-sm">
                Reset
              </button>
            </div>
          </div>
        )}

        {vaultStatus === 'unlocked' && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--status-success)' }}>
              Vault is unlocked and ready for AI requests.
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={handleLock} className="ait-btn ait-btn-secondary ait-btn-sm">
                <IconLock size={11} />
                <span>Lock</span>
              </button>
              <button onClick={handleReset} className="ait-btn ait-btn-danger ait-btn-sm">
                Reset
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── AI Provider section ── */}
      <div className="ait-card" style={{ background: 'var(--bg-surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <IconWand size={16} color="var(--accent-secondary)" />
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>LLM Provider Settings</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }}>PROVIDER ADAPTER</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as 'openai' | 'anthropic')}
              className="ait-select"
              style={{ marginTop: 2 }}
            >
              <option value="openai">OpenAI-compatible (OpenAI, LM Studio, Ollama, OpenRouter)</option>
              <option value="anthropic">Anthropic (Claude)</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }}>BASE URL</label>
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com/v1'}
              className="ait-input"
              style={{ marginTop: 2 }}
            />
          </div>

          <div>
            <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }}>MODEL NAME</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={provider === 'openai' ? 'gpt-4o-mini' : 'claude-3-5-sonnet-20241022'}
              className="ait-input"
              style={{ marginTop: 2 }}
            />
          </div>

          <div>
            <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }}>REASONING EFFORT</label>
            <select
              value={reasoningEffort}
              onChange={(e) => setReasoningEffort(e.target.value as '' | 'low' | 'medium' | 'high')}
              className="ait-select"
              style={{ marginTop: 2 }}
            >
              <option value="">Off / Default</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }}>API KEY (VAULT STORED)</label>
            {vaultStatus === 'unlocked' ? (
              <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="ait-input"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="ait-btn ait-btn-secondary ait-btn-icon"
                >
                  {showApiKey ? <IconEyeOff size={13} /> : <IconEye size={13} />}
                </button>
              </div>
            ) : (
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--status-warning)',
                  background: 'var(--status-warning-bg)',
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-sm)',
                  marginTop: 2,
                }}
              >
                Unlock vault above to view or set API key.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Debug section ── */}
      <div className="ait-card" style={{ background: 'var(--bg-surface)', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <IconZap size={15} color="var(--status-info)" />
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>Debug & Diagnostics</span>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: 'var(--text-primary)' }}>
          <input
            type="checkbox"
            checked={debugEnabled}
            onChange={async (e) => {
              const on = e.target.checked;
              setDebugEnabled_(on);
              await setDebugEnabled(on);
            }}
          />
          Enable Verbose Extension Console Logging
        </label>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, paddingLeft: 22 }}>
          Logs state machine broadcasts, selector lookups, and vault actions to browser dev console.
        </div>
      </div>

      {/* Save Button */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="ait-btn ait-btn-primary"
        style={{ width: '100%', padding: '9px 16px' }}
      >
        <IconSave size={14} />
        <span>{saving ? 'Saving Settings…' : 'Save All Settings'}</span>
      </button>
    </section>
  );
}
