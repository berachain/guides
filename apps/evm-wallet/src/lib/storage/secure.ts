import Constants from 'expo-constants';
import * as Keychain from 'react-native-keychain';
import * as WalletCrypto from 'wallet-crypto';
import { isValidEvmAddress } from '../crypto/evm';
import type { WalletAccount, WalletManifest } from '../types';

/**
 * IMPORTANT: the per-wallet mnemonic Keychain items are owned by the native
 * `wallet-crypto` Expo module (see `modules/wallet-crypto/ios/KeychainBridge.swift`).
 * Keep this service name format in sync with `KeychainBridge.service(for:)`
 * on the Swift side forever — items written there must be readable here (for
 * migration / dev diagnostics) and vice versa.
 */
export function mnemonicService(id: string): string {
  return `wallet.mnemonic.${id}`;
}

/**
 * Typed error surface for the native `wallet-crypto` module. The Expo bridge
 * hands us string error codes (`E_USER_CANCELED`, etc.) on the thrown
 * exception; the wrappers below translate those into this structured form
 * so screens can branch on `.code` instead of matching error strings.
 */
export type WalletCryptoErrorCode =
  | 'USER_CANCELED'
  | 'BIOMETRY_UNAVAILABLE'
  | 'CORRUPT_STATE'
  | 'NOT_FOUND'
  | 'UNKNOWN';

export class WalletCryptoError extends Error {
  code: WalletCryptoErrorCode;
  constructor(code: WalletCryptoErrorCode, message: string) {
    super(message);
    this.name = 'WalletCryptoError';
    this.code = code;
  }
}

function nativeErrorCode(err: unknown): string | null {
  if (err === null || typeof err !== 'object') return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function toWalletCryptoError(err: unknown, fallback: string): WalletCryptoError {
  const code = nativeErrorCode(err);
  const message = err instanceof Error ? err.message : String(err);
  switch (code) {
    case 'E_USER_CANCELED':
      return new WalletCryptoError('USER_CANCELED', message || fallback);
    case 'E_BIOMETRY_UNAVAILABLE':
      return new WalletCryptoError('BIOMETRY_UNAVAILABLE', message || fallback);
    case 'E_CORRUPT_STATE':
      return new WalletCryptoError('CORRUPT_STATE', message || fallback);
    case 'E_NOT_FOUND':
      return new WalletCryptoError('NOT_FOUND', message || fallback);
    default:
      return new WalletCryptoError('UNKNOWN', `${fallback}: ${message}`);
  }
}

const MANIFEST_SERVICE = 'wallet.manifest.v1';
const MANIFEST_USERNAME = 'manifest';
const MANIFEST_SCHEMA_VERSION = 3;

type KeychainScope = { service: string; cloudSync?: true };

function scope(service: string, icloudBackedUp: boolean): KeychainScope {
  return icloudBackedUp ? { service, cloudSync: true } : { service };
}

// ---------------------------------------------------------------------------
// Per-wallet mnemonic: delegate entirely to the native module.
//
// The native module generates entropy, computes BIP39, writes/reads/deletes
// the Keychain item, and owns the sensitive `Data` buffer. The plaintext
// mnemonic string only ever crosses the bridge in `readMnemonic`.
// ---------------------------------------------------------------------------

/**
 * Generate fresh entropy in Swift, convert to a 24-word BIP39 mnemonic, and
 * store it in the Keychain. Returns the newly-minted wallet id. The
 * plaintext mnemonic does not cross the bridge here.
 *
 * Simulator builds use the native plaintext fallback for both sync modes.
 * Device builds throw `WalletCryptoError` with code `BIOMETRY_UNAVAILABLE`
 * if the Secure Enclave path is requested without usable biometrics or
 * passcode.
 */
export async function generateAndStoreMnemonic(icloudBackedUp: boolean): Promise<string> {
  try {
    return await WalletCrypto.generateAndStoreMnemonic(icloudBackedUp);
  } catch (err) {
    throw toWalletCryptoError(err, 'Failed to generate and store mnemonic');
  }
}

/**
 * True only for simulator builds. Used by UI to label the native plaintext
 * fallback; device security does not depend on this value.
 */
export function isRunningOnSimulator(): boolean {
  return WalletCrypto.isRunningOnSimulator() || Constants.isDevice === false;
}

/**
 * Read the stored mnemonic for `id`.
 *
 *   - Returns `null` when no wallet exists for `id` OR the user canceled
 *     the biometric prompt. Callers are expected to distinguish the two
 *     via the preceding state (if we know the wallet exists, `null` must
 *     be treated as user-cancel).
 *   - Throws `WalletCryptoError` with code `BIOMETRY_UNAVAILABLE` or
 *     `CORRUPT_STATE` when the native layer reports those; the caller
 *     decides how to surface them.
 *
 * `prompt` is the localized reason shown in the biometric sheet on the
 * Secure-Enclave path (ignored on the plaintext path and simulator fallback).
 *
 * The returned string is the single intentional plaintext bridge crossing
 * — callers must drop the reference as soon as the reveal UI unmounts.
 */
export async function readMnemonic(id: string, prompt?: string): Promise<string | null> {
  try {
    return await WalletCrypto.revealMnemonic(id, prompt);
  } catch (err) {
    const wrapped = toWalletCryptoError(err, 'Failed to read mnemonic');
    if (wrapped.code === 'NOT_FOUND' || wrapped.code === 'USER_CANCELED') {
      return null;
    }
    throw wrapped;
  }
}

/**
 * Returns the 64-byte BIP39 seed as hex. The caller must convert, use, and
 * drop it immediately; never persist or log this value.
 */
export async function deriveSeed(id: string, prompt: string): Promise<string> {
  try {
    return await WalletCrypto.deriveSeedFromMnemonic(id, prompt);
  } catch (err) {
    throw toWalletCryptoError(err, 'Failed to derive seed');
  }
}

/**
 * Delete the Keychain entry for `id`. Idempotent; matches both synced and
 * local variants. Also removes the Secure Enclave private key and wrapped
 * AES key, when present.
 */
export async function deleteMnemonic(id: string): Promise<void> {
  try {
    await WalletCrypto.deleteMnemonic(id);
  } catch (err) {
    throw toWalletCryptoError(err, 'Failed to delete mnemonic');
  }
}

/**
 * Existence probe used by the restore flow and dev diagnostics. Does not
 * return plaintext.
 */
export async function mnemonicExists(id: string): Promise<boolean> {
  try {
    return await WalletCrypto.mnemonicExists(id);
  } catch (err) {
    throw toWalletCryptoError(err, 'Failed to check mnemonic existence');
  }
}

/**
 * Migrate an existing stored mnemonic between local-only and iCloud-synced
 * modes. On device, local → iCloud triggers a biometric prompt (iOS needs
 * to unwrap the AES key to re-store the mnemonic as plaintext). iCloud →
 * local does not prompt (the plaintext is already readable without
 * biometrics). On simulator, both modes are plaintext and this only flips
 * the Keychain sync state.
 *
 * Throws `WalletCryptoError` with code `USER_CANCELED` if the user
 * dismissed the biometric sheet on the local → iCloud path. The caller
 * should surface a non-destructive retry UI — the wallet is unchanged.
 */
export async function setMnemonicSyncState(
  id: string,
  icloudBackedUp: boolean,
  prompt?: string,
): Promise<void> {
  try {
    await WalletCrypto.setMnemonicSyncState(id, icloudBackedUp, prompt);
  } catch (err) {
    throw toWalletCryptoError(err, 'Failed to update mnemonic sync state');
  }
}

/**
 * Updates the mnemonic sync state and returns seed hex from the same native
 * plaintext window, avoiding double biometric prompts on device.
 */
export async function setSyncStateAndDeriveSeed(
  id: string,
  icloudBackedUp: boolean,
  prompt: string,
): Promise<string> {
  try {
    return await WalletCrypto.setSyncStateAndDeriveSeed(id, icloudBackedUp, prompt);
  } catch (err) {
    throw toWalletCryptoError(err, 'Failed to update sync state and derive seed');
  }
}

// ---------------------------------------------------------------------------
// Manifest: still handled by `react-native-keychain`. The manifest is tiny,
// its encoding is JSON, and the Stage 5 behavior (synced + local variants,
// schema validation, stale-cleanup) is well tested. Rewriting it in Swift
// in the same stage would be high-risk for low reward.
// ---------------------------------------------------------------------------

/**
 * Write the synced manifest that lists all known wallets.
 *
 * When `anySynced` is false we also proactively delete any *synced* manifest
 * that may exist from a prior state — otherwise the two variants (a stale
 * synced one + a fresh local one) would coexist and restore-on-reinstall
 * would read the stale synced copy.
 */
export async function writeManifest(manifest: WalletManifest, anySynced: boolean): Promise<void> {
  const payload = JSON.stringify(manifest);
  const accessible = anySynced
    ? Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK
    : Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY;

  if (!anySynced) {
    try {
      await Keychain.resetGenericPassword({ service: MANIFEST_SERVICE, cloudSync: true });
    } catch {
      // ignore — manifest write below is the real operation
    }
  }

  try {
    await Keychain.setGenericPassword(MANIFEST_USERNAME, payload, {
      ...scope(MANIFEST_SERVICE, anySynced),
      accessible,
    });
  } catch (err) {
    throw new Error(`Failed to write manifest: ${String(err)}`);
  }
}

/**
 * Read the manifest from the Keychain. Tries the synced variant first (so
 * post-reinstall on an iCloud-Keychain-enabled device finds the synced copy),
 * then falls back to local-only. Returns `null` when nothing is found OR when
 * the stored payload is corrupt — a corrupted manifest must not block app
 * launch.
 */
export async function readManifest(): Promise<WalletManifest | null> {
  const payload = (await tryReadManifestPayload(true)) ?? (await tryReadManifestPayload(false));
  if (payload === null) return null;

  try {
    const parsed: unknown = JSON.parse(payload);
    if (!isWalletManifest(parsed)) return null;
    return normalizeManifest(parsed);
  } catch {
    return null;
  }
}

async function tryReadManifestPayload(icloudBackedUp: boolean): Promise<string | null> {
  try {
    const result = await Keychain.getGenericPassword(scope(MANIFEST_SERVICE, icloudBackedUp));
    if (result === false) return null;
    return result.password.length > 0 ? result.password : null;
  } catch {
    return null;
  }
}

function isWalletManifest(value: unknown): value is WalletManifest {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.schemaVersion === 1 && Array.isArray(v.entries)) {
    return v.entries.every(isLegacyManifestEntry);
  }
  if (v.schemaVersion !== 2 && v.schemaVersion !== MANIFEST_SCHEMA_VERSION) return false;
  if (!Array.isArray(v.entries)) return false;
  return v.entries.every(isLegacyManifestEntry);
}

function isWalletAccount(value: unknown): value is WalletAccount {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.index === 'number' &&
    Number.isInteger(v.index) &&
    typeof v.address === 'string' &&
    (typeof v.name === 'undefined' || typeof v.name === 'string') &&
    (typeof v.hidden === 'undefined' || typeof v.hidden === 'boolean')
  );
}

function isLegacyManifestEntry(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.label === 'string' &&
    typeof v.createdAt === 'number' &&
    typeof v.icloudBackedUp === 'boolean'
  );
}

function normalizeManifest(
  value: WalletManifest | { schemaVersion: 1 | 2; entries: unknown[] },
): WalletManifest {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    entries: value.entries.filter(isLegacyManifestEntry).map((entry) => {
      const e = entry as Record<string, unknown>;
      const id = e.id as string;
      const accounts = Array.isArray(e.accounts)
        ? e.accounts.filter(isWalletAccount).map((account) => normalizeManifestAccount(account, id))
        : [];
      return {
        id,
        label: e.label as string,
        createdAt: e.createdAt as number,
        icloudBackedUp: e.icloudBackedUp as boolean,
        // Lazy Stage 7 migration: old manifests lack addresses. We avoid
        // surprise biometric prompts during manifest read and derive later.
        accounts,
        primaryAccountIndex:
          typeof e.primaryAccountIndex === 'number' && Number.isInteger(e.primaryAccountIndex)
            ? e.primaryAccountIndex
            : 0,
      };
    }),
  };
}

function normalizeManifestAccount(account: WalletAccount, walletId: string): WalletAccount {
  if (!isValidEvmAddress(account.address)) {
    console.warn(`readManifest: invalid address for wallet ${walletId} account ${account.index}`);
  }
  return {
    index: account.index,
    address: account.address,
    name: account.name?.trim() || undefined,
    hidden: account.hidden === true,
  };
}

/**
 * Delete the manifest across both sync variants. Idempotent.
 */
export async function deleteManifest(): Promise<void> {
  const errors: unknown[] = [];
  try {
    await Keychain.resetGenericPassword({ service: MANIFEST_SERVICE });
  } catch (err) {
    errors.push(err);
  }
  try {
    await Keychain.resetGenericPassword({ service: MANIFEST_SERVICE, cloudSync: true });
  } catch (err) {
    errors.push(err);
  }
  if (errors.length === 2) {
    throw new Error(`Failed to delete manifest: ${String(errors[0])}`);
  }
}
