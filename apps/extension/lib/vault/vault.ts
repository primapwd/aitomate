import { browser } from 'wxt/browser';
import {
  DEFAULT_PBKDF2_ITERATIONS,
  deriveKey,
  decryptJson,
  encryptJson,
  fromBase64,
  generateSalt,
  toBase64,
  type CryptoPayload,
} from './crypto';

/**
 * Local encrypted secrets vault (spec T1.3, NFR Security, FR-9).
 *
 * Zero-setup baseline (Constitution): nothing may call `unlock`/`initialize`
 * on the static-only scenario path. UI prompts for the passphrase lazily —
 * only when a scenario actually needs a vault-backed feature (AI or DB).
 *
 * At rest in `browser.storage.local`:
 * - meta (salt, iteration count, verifier) — plaintext envelope, no secrets.
 * - index (entry kind+name list) — plaintext BY DESIGN: connector/provider
 *   *names* are non-secret (shareable via team manifest, FR-9) and the UI must
 *   report which entries are missing without forcing an unlock.
 * - data (all entry values) — single AES-GCM blob, only readable after unlock.
 *
 * The derived key lives in memory only; when the background service worker is
 * torn down, the vault reverts to locked.
 */

const META_KEY = 'aitomate:vault:meta';
const INDEX_KEY = 'aitomate:vault:index';
const DATA_KEY = 'aitomate:vault:data';

/** Decrypting this constant successfully proves the passphrase is correct. */
const VERIFIER_VALUE = 'aitomate-vault-verifier-v1';

export type VaultStatus = 'uninitialized' | 'locked' | 'unlocked';

export type VaultEntryKind = 'llm-provider' | 'db-connector';

export interface VaultEntryRef {
  kind: VaultEntryKind;
  name: string;
}

interface VaultMeta {
  version: 1;
  salt: string;
  iterations: number;
  verifier: CryptoPayload;
}

type VaultData = Record<string, unknown>;

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Plain-language messages (Constitution: fail loud, fail clear). */
export class VaultLockedError extends VaultError {
  constructor() {
    super('The secure vault is locked. Enter your passphrase to continue.');
  }
}

export class WrongPassphraseError extends VaultError {
  constructor() {
    super('That passphrase is not correct. Please try again.');
  }
}

export class VaultNotInitializedError extends VaultError {
  constructor() {
    super(
      'No secure vault exists yet on this device. Set a passphrase to create one.',
    );
  }
}

function entryKey(kind: VaultEntryKind, name: string): string {
  return `${kind}:${name}`;
}

export interface VaultOptions {
  /** Override for tests only; production uses DEFAULT_PBKDF2_ITERATIONS. */
  iterations?: number;
}

export class Vault {
  #key: CryptoKey | null = null;
  readonly #iterations: number;

  constructor(options: VaultOptions = {}) {
    this.#iterations = options.iterations ?? DEFAULT_PBKDF2_ITERATIONS;
  }

  async getStatus(): Promise<VaultStatus> {
    if (this.#key) return 'unlocked';
    const meta = await this.#readMeta();
    return meta ? 'locked' : 'uninitialized';
  }

  /** Create the vault with a new passphrase; leaves it unlocked. */
  async initialize(passphrase: string): Promise<void> {
    if (await this.#readMeta()) {
      throw new VaultError(
        'A vault already exists on this device. Unlock it instead, or reset it first.',
      );
    }
    const salt = generateSalt();
    const key = await deriveKey(passphrase, salt, this.#iterations);
    const meta: VaultMeta = {
      version: 1,
      salt: toBase64(salt),
      iterations: this.#iterations,
      verifier: await encryptJson(key, VERIFIER_VALUE),
    };
    await browser.storage.local.set({
      [META_KEY]: meta,
      [INDEX_KEY]: [] satisfies VaultEntryRef[],
      [DATA_KEY]: await encryptJson(key, {} satisfies VaultData),
    });
    this.#key = key;
  }

  async unlock(passphrase: string): Promise<void> {
    const meta = await this.#readMeta();
    if (!meta) throw new VaultNotInitializedError();
    const key = await deriveKey(
      passphrase,
      fromBase64(meta.salt),
      meta.iterations,
    );
    try {
      const verifier = await decryptJson<string>(key, meta.verifier);
      if (verifier !== VERIFIER_VALUE) throw new WrongPassphraseError();
    } catch (error) {
      if (error instanceof WrongPassphraseError) throw error;
      throw new WrongPassphraseError();
    }
    this.#key = key;
  }

  lock(): void {
    this.#key = null;
  }

  /** Works while locked — names are non-secret (see module doc). */
  async listEntries(): Promise<VaultEntryRef[]> {
    const stored = await browser.storage.local.get(INDEX_KEY);
    return (stored[INDEX_KEY] as VaultEntryRef[] | undefined) ?? [];
  }

  async setEntry(
    kind: VaultEntryKind,
    name: string,
    value: unknown,
  ): Promise<void> {
    const data = await this.#readData();
    data[entryKey(kind, name)] = value;
    await this.#writeData(data);
    const index = await this.listEntries();
    if (!index.some((ref) => ref.kind === kind && ref.name === name)) {
      await browser.storage.local.set({ [INDEX_KEY]: [...index, { kind, name }] });
    }
  }

  /** Returns undefined when the entry does not exist. */
  async getEntry<T = unknown>(
    kind: VaultEntryKind,
    name: string,
  ): Promise<T | undefined> {
    const data = await this.#readData();
    return data[entryKey(kind, name)] as T | undefined;
  }

  async deleteEntry(kind: VaultEntryKind, name: string): Promise<void> {
    const data = await this.#readData();
    delete data[entryKey(kind, name)];
    await this.#writeData(data);
    const index = await this.listEntries();
    await browser.storage.local.set({
      [INDEX_KEY]: index.filter(
        (ref) => !(ref.kind === kind && ref.name === name),
      ),
    });
  }

  /** Re-encrypts everything under a key derived from the new passphrase. */
  async changePassphrase(current: string, next: string): Promise<void> {
    await this.unlock(current);
    const data = await this.#readData();
    const salt = generateSalt();
    const key = await deriveKey(next, salt, this.#iterations);
    const meta: VaultMeta = {
      version: 1,
      salt: toBase64(salt),
      iterations: this.#iterations,
      verifier: await encryptJson(key, VERIFIER_VALUE),
    };
    await browser.storage.local.set({
      [META_KEY]: meta,
      [DATA_KEY]: await encryptJson(key, data),
    });
    this.#key = key;
  }

  /**
   * Destroys the vault and every stored secret (forgotten passphrase path).
   * Irreversible; callers must confirm with the user first.
   */
  async reset(): Promise<void> {
    await browser.storage.local.remove([META_KEY, INDEX_KEY, DATA_KEY]);
    this.#key = null;
  }

  async #readMeta(): Promise<VaultMeta | null> {
    const stored = await browser.storage.local.get(META_KEY);
    return (stored[META_KEY] as VaultMeta | undefined) ?? null;
  }

  #requireKey(): CryptoKey {
    if (!this.#key) throw new VaultLockedError();
    return this.#key;
  }

  async #readData(): Promise<VaultData> {
    const key = this.#requireKey();
    const stored = await browser.storage.local.get(DATA_KEY);
    const payload = stored[DATA_KEY] as CryptoPayload | undefined;
    if (!payload) throw new VaultNotInitializedError();
    return decryptJson<VaultData>(key, payload);
  }

  async #writeData(data: VaultData): Promise<void> {
    const key = this.#requireKey();
    await browser.storage.local.set({
      [DATA_KEY]: await encryptJson(key, data),
    });
  }
}

/** Singleton for the background service worker. */
export const vault = new Vault();

/**
 * Create-or-unlock a vault with the given passphrase.
 *
 * The popup and background each run their own `Vault` instance (separate JS
 * realms, no shared in-memory `#key`) but share the same `browser.storage`
 * backing. When the popup's own instance creates the vault first, a plain
 * `initialize()` call against the background's instance would see the
 * meta already on disk and throw "vault already exists" — leaving the
 * background instance's key unset, i.e. still effectively locked, even
 * though the UI reported success. Deriving the key via `unlock()` instead
 * once the vault already exists is what actually unlocks that instance.
 */
export async function unlockOrInitialize(v: Vault, passphrase: string): Promise<void> {
  const status = await v.getStatus();
  if (status === 'uninitialized') {
    await v.initialize(passphrase);
  } else {
    await v.unlock(passphrase);
  }
}
