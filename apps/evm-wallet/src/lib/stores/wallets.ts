import { create } from 'zustand';
import { deriveAndCleanupAddress } from '../crypto/orchestration';
import { type BiometricCapability, getBiometricCapability } from '../security/biometrics';
import {
  readNextLabelNumber,
  readWalletIndex,
  writeNextLabelNumber,
  writeWalletIndex,
} from '../storage/mmkv';
import {
  deleteManifest,
  deleteMnemonic,
  generateAndStoreMnemonic,
  mnemonicExists,
  readMnemonic,
  WalletCryptoError,
  writeManifest,
} from '../storage/secure';
import type {
  SecurityWarning,
  WalletAccount,
  WalletIndexEntry,
  WalletManifest,
  WalletManifestEntry,
} from '../types';

export interface RestoreProgress {
  completed: number;
  total: number;
  label: string;
}

export interface RestoreOptions {
  onProgress?: (progress: RestoreProgress) => void;
  shouldContinueAfterCancel?: (entry: WalletManifestEntry) => Promise<boolean>;
}

interface WalletsState {
  wallets: WalletIndexEntry[];
  nextLabelNumber: number;
  /**
   * Id of the wallet whose mnemonic is currently mid-creation. The mnemonic
   * itself lives in the iOS Keychain — never in JS state, never persisted in
   * MMKV, never logged. A non-null value here means there is an "orphaned"
   * Keychain entry that `cancelPendingCreation` is responsible for cleaning up.
   */
  pendingWalletId: string | null;
  pendingIcloudOptIn: boolean;
  /** `true` after the initial MMKV read completes. Gate navigation on this. */
  hydrated: boolean;
  /**
   * Populated at app launch if `jail-monkey` heuristics suggest the device is
   * compromised. `null` on a clean device. User advisory only.
   */
  securityWarning: SecurityWarning | null;
  /**
   * Cached result of `getBiometricCapability`. Populated lazily (on first
   * call to `ensureBiometricCapability`) and reused across screens so we do
   * not spam `expo-local-authentication` APIs. Non-persistent.
   */
  biometricCapability: BiometricCapability | null;

  hydrate: () => void;
  setSecurityWarning: (w: SecurityWarning | null) => void;
  setPendingIcloudOptIn: (v: boolean) => void;
  /** Fetch + cache the biometric capability. Safe to call repeatedly. */
  ensureBiometricCapability: () => Promise<BiometricCapability>;

  /**
   * Generate a fresh mnemonic in the native module and store it in the
   * Keychain as a *local-only* item. Returns the new pending wallet id.
   * The mnemonic is not yet attached to the wallet index or manifest; call
   * `commitPendingCreation` to finalize, or `cancelPendingCreation` to
   * delete the orphaned Keychain entry.
   *
   * Generates local-only initially so the user's "write it down" output is
   * stable across the iCloud toggle — flipping the toggle on the confirm
   * screen migrates the same bytes via `setMnemonicSyncState` rather than
   * regenerating.
   */
  beginPendingCreation: () => Promise<string>;

  /**
   * Finalize the pending wallet: append to the wallet index, bump the label
   * counter, and sync the iCloud manifest. The Keychain item must already be
   * in its final sync state (see the confirm screen's call to
   * `setMnemonicSyncState`).
   */
  commitPendingCreation: (prederivedAddress?: string) => Promise<WalletIndexEntry>;

  /**
   * Async: deletes the orphaned Keychain entry (if any) and clears the pending
   * state. Callers should `await` this before navigating away.
   *
   * Contract note: `deleteMnemonic` is a pure `SecItemDelete` call (plus SE
   * key deletion via `SecItemDelete` under a different class). None of
   * those operations trigger a biometric prompt — biometrics gate SE key
   * *usage*, not deletion. So this action is safe to call silently even
   * while a pending SE-wrapped wallet exists.
   */
  cancelPendingCreation: () => Promise<void>;

  /**
   * Read the pending wallet's mnemonic. On device, Stage 6b local wallets
   * trigger the biometric prompt here; simulator builds use the native
   * plaintext fallback and do not prompt. Returns `null` on user cancel so
   * the reveal screen can show a retry affordance without destructive
   * side-effects.
   */
  revealPendingMnemonic: (prompt?: string) => Promise<string | null>;

  /**
   * Restore wallets listed in the iCloud manifest. Mnemonics are expected to
   * already be present in the local Keychain (iOS performs the sync before
   * first read); for each manifest entry we verify existence via
   * `mnemonicExists` and skip any missing ones. No plaintext is ever held
   * in JS during restore.
   */
  restoreFromManifestNative: (
    manifest: WalletManifest,
    options?: RestoreOptions,
  ) => Promise<WalletIndexEntry[]>;

  deriveAddressForWallet: (id: string) => Promise<WalletIndexEntry>;
  addAccount: (walletId: string, name?: string) => Promise<WalletAccount>;
  restorePendingAccount: (walletId: string, accountIndex: number) => Promise<WalletAccount>;
  setAccountHidden: (walletId: string, accountIndex: number, hidden: boolean) => Promise<void>;
  setAccountName: (walletId: string, accountIndex: number, name?: string) => Promise<void>;
  setPrimaryAccount: (walletId: string, accountIndex: number) => Promise<void>;
  deleteWallet: (id: string) => Promise<void>;
  resetAll: () => Promise<void>;
}

export function getVisibleAccounts(wallet: WalletIndexEntry): WalletAccount[] {
  return wallet.accounts.filter((account) => !account.hidden).sort((a, b) => a.index - b.index);
}

export function getHiddenAccounts(wallet: WalletIndexEntry): WalletAccount[] {
  return wallet.accounts.filter((account) => account.hidden).sort((a, b) => a.index - b.index);
}

export function getPrimaryAccount(wallet: WalletIndexEntry): WalletAccount {
  const account = wallet.accounts.find((a) => a.index === wallet.primaryAccountIndex);
  if (!account) {
    throw new Error(`Missing primary account for wallet ${wallet.id}`);
  }
  return account;
}

const INITIAL_STATE = {
  wallets: [] as WalletIndexEntry[],
  nextLabelNumber: 1,
  pendingWalletId: null,
  pendingIcloudOptIn: false,
  hydrated: false,
  securityWarning: null,
  biometricCapability: null as BiometricCapability | null,
} as const;

function toManifest(entries: WalletIndexEntry[]): WalletManifest {
  const manifestEntries: WalletManifestEntry[] = entries.map((e) => ({
    id: e.id,
    label: e.label,
    createdAt: e.createdAt,
    icloudBackedUp: e.icloudBackedUp,
    accounts: mergeManifestAccounts(e.accounts, e.pendingAccounts),
    primaryAccountIndex: e.primaryAccountIndex,
  }));
  return { schemaVersion: 3, entries: manifestEntries };
}

function mergeManifestAccounts(
  accounts: WalletAccount[],
  pendingAccounts: WalletAccount[] | undefined,
): WalletAccount[] {
  const byIndex = new Map<number, WalletAccount>();
  for (const account of pendingAccounts ?? []) byIndex.set(account.index, account);
  for (const account of accounts) byIndex.set(account.index, account);
  return Array.from(byIndex.values()).sort((a, b) => a.index - b.index);
}

function anySynced(entries: WalletIndexEntry[]): boolean {
  return entries.some((e) => e.icloudBackedUp);
}

/**
 * Best-effort manifest sync after a successful wallet-set mutation.
 *
 * We intentionally do NOT roll back the preceding Keychain + MMKV writes if
 * this fails: the wallet itself is real and usable. The only consequence of
 * a failed manifest write is that restore-on-reinstall is unavailable until
 * the next mutation successfully rewrites it.
 */
async function syncManifest(entries: WalletIndexEntry[]): Promise<string | null> {
  try {
    await writeManifest(toManifest(entries), anySynced(entries));
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function nextLabelNumberFor(entries: WalletIndexEntry[], fallback: number): number {
  const highestUsed = entries.reduce<number>((acc, entry) => {
    const match = /^Mnemonic #(\d+)$/.exec(entry.label);
    if (!match?.[1]) return acc;
    const n = Number.parseInt(match[1], 10);
    return Number.isFinite(n) && n > acc ? n : acc;
  }, 0);
  return Math.max(fallback, highestUsed + 1);
}

function cleanAccountName(name?: string): string | undefined {
  const trimmed = name?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > 32) {
    throw new Error('Account name must be 32 characters or fewer');
  }
  return trimmed;
}

function recoverHiddenPrimaryAccounts(wallets: WalletIndexEntry[]): WalletIndexEntry[] {
  return wallets.map((wallet) => {
    const primary = wallet.accounts.find((account) => account.index === wallet.primaryAccountIndex);
    if (!primary?.hidden) return wallet;
    console.warn(`hydrate: recovered hidden primary account for wallet ${wallet.id}`);
    return {
      ...wallet,
      accounts: wallet.accounts.map((account) =>
        account.index === wallet.primaryAccountIndex ? { ...account, hidden: false } : account,
      ),
    };
  });
}

function replaceWallet(
  wallets: WalletIndexEntry[],
  walletId: string,
  updater: (wallet: WalletIndexEntry) => WalletIndexEntry,
): WalletIndexEntry[] {
  let found = false;
  const nextWallets = wallets.map((wallet) => {
    if (wallet.id !== walletId) return wallet;
    found = true;
    return updater(wallet);
  });
  if (!found) {
    throw new Error(`Unknown wallet ${walletId}`);
  }
  return nextWallets;
}

export const useWalletsStore = create<WalletsState>((set, get) => ({
  ...INITIAL_STATE,

  hydrate: () => {
    if (get().hydrated) return;
    const wallets = recoverHiddenPrimaryAccounts(readWalletIndex());
    const nextLabelNumber = readNextLabelNumber();
    writeWalletIndex(wallets);
    set({ wallets, nextLabelNumber, hydrated: true });
  },

  setSecurityWarning: (warning) => {
    set({ securityWarning: warning });
  },

  setPendingIcloudOptIn: (value) => {
    set({ pendingIcloudOptIn: value });
  },

  ensureBiometricCapability: async () => {
    const cached = get().biometricCapability;
    if (cached !== null) return cached;
    const capability = await getBiometricCapability();
    set({ biometricCapability: capability });
    return capability;
  },

  beginPendingCreation: async () => {
    // Clean up any prior pending entry first (defensive — shouldn't happen
    // under normal navigation but avoids a Keychain leak if it does).
    const prior = get().pendingWalletId;
    if (prior !== null) {
      try {
        await deleteMnemonic(prior);
      } catch {
        // best-effort cleanup
      }
    }

    // Stage 6b stores the pending mnemonic on the local path: SE-wrapped on
    // physical devices, plaintext in simulator builds via the native fallback.
    // Letting the native error propagate (via `WalletCryptoError`) means the
    // generate screen can show biometrics-required copy on
    // `BIOMETRY_UNAVAILABLE` and a generic alert otherwise.
    const id = await generateAndStoreMnemonic(false);
    set({ pendingWalletId: id, pendingIcloudOptIn: false });
    return id;
  },

  revealPendingMnemonic: async (prompt) => {
    const { pendingWalletId } = get();
    if (pendingWalletId === null) return null;
    // `readMnemonic` already folds USER_CANCELED (and NOT_FOUND) into a
    // null return; BIOMETRY_UNAVAILABLE / CORRUPT_STATE propagate as
    // `WalletCryptoError` so the reveal screen can route / alert
    // appropriately.
    return readMnemonic(pendingWalletId, prompt);
  },

  commitPendingCreation: async (prederivedAddress) => {
    const { pendingWalletId, pendingIcloudOptIn, nextLabelNumber, wallets } = get();
    if (pendingWalletId === null) {
      throw new Error('commitPendingCreation: no pendingWalletId to commit');
    }
    const address =
      prederivedAddress ??
      (await deriveAndCleanupAddress(pendingWalletId, 0, 'Authenticate to set up your wallet'));
    const entry: WalletIndexEntry = {
      id: pendingWalletId,
      label: `Mnemonic #${nextLabelNumber}`,
      createdAt: Date.now(),
      icloudBackedUp: pendingIcloudOptIn,
      accounts: [{ index: 0, address, hidden: false }],
      primaryAccountIndex: 0,
    };

    const nextWallets = [...wallets, entry];
    const nextCounter = nextLabelNumber + 1;
    writeWalletIndex(nextWallets);
    writeNextLabelNumber(nextCounter);

    set({
      wallets: nextWallets,
      nextLabelNumber: nextCounter,
      pendingWalletId: null,
      pendingIcloudOptIn: false,
    });

    const manifestError = await syncManifest(nextWallets);
    if (manifestError !== null) {
      throw new Error(
        `Wallet saved, but iCloud backup manifest could not be updated: ${manifestError}`,
      );
    }
    return entry;
  },

  cancelPendingCreation: async () => {
    const { pendingWalletId } = get();
    if (pendingWalletId !== null) {
      try {
        await deleteMnemonic(pendingWalletId);
      } catch (err) {
        // Log id only — no mnemonic content exists in JS to leak.
        console.warn(`cancelPendingCreation: delete failed for ${pendingWalletId}: ${String(err)}`);
      }
    }
    set({ pendingWalletId: null, pendingIcloudOptIn: false });
  },

  restoreFromManifestNative: async (manifest, options) => {
    const restored: WalletIndexEntry[] = [];
    const total = manifest.entries.length;
    for (const entry of manifest.entries) {
      let present = false;
      try {
        present = await mnemonicExists(entry.id);
      } catch (err) {
        console.warn(
          `restoreFromManifestNative: exists check failed for ${entry.id}: ${String(err)}`,
        );
        continue;
      }
      if (!present) {
        console.warn(`restoreFromManifestNative: Keychain entry missing for ${entry.id}, skipping`);
        options?.onProgress?.({ completed: restored.length, total, label: entry.label });
        continue;
      }
      let address: string;
      try {
        address = await deriveAndCleanupAddress(entry.id, 0, 'Authenticate to restore your wallet');
      } catch (err) {
        if (err instanceof WalletCryptoError && err.code === 'USER_CANCELED') {
          const shouldContinue = await options?.shouldContinueAfterCancel?.(entry);
          if (shouldContinue) {
            options?.onProgress?.({ completed: restored.length, total, label: entry.label });
            continue;
          }
          break;
        }
        console.warn(
          `restoreFromManifestNative: address derivation failed for ${entry.id}: ${String(err)}`,
        );
        options?.onProgress?.({ completed: restored.length, total, label: entry.label });
        continue;
      }
      const manifestPrimary =
        entry.accounts.find((account) => account.index === entry.primaryAccountIndex) ??
        entry.accounts.find((account) => account.index === 0);
      const primaryIndex = manifestPrimary?.index ?? 0;
      const primaryName = manifestPrimary?.name;
      const pendingAccounts = entry.accounts
        .filter((account) => account.index !== primaryIndex)
        .sort((a, b) => a.index - b.index);
      restored.push({
        id: entry.id,
        label: entry.label,
        createdAt: entry.createdAt,
        icloudBackedUp: entry.icloudBackedUp,
        accounts: [{ index: primaryIndex, address, name: primaryName, hidden: false }],
        primaryAccountIndex: primaryIndex,
        pendingAccountIndices:
          pendingAccounts.length > 0 ? pendingAccounts.map((account) => account.index) : undefined,
        pendingAccounts: pendingAccounts.length > 0 ? pendingAccounts : undefined,
      });
      options?.onProgress?.({ completed: restored.length, total, label: entry.label });
    }

    if (restored.length === 0) return restored;

    const existing = get().wallets;
    const byId = new Map<string, WalletIndexEntry>();
    for (const w of existing) byId.set(w.id, w);
    for (const w of restored) byId.set(w.id, w);
    const mergedWallets = Array.from(byId.values()).sort((a, b) => a.createdAt - b.createdAt);

    const nextCounter = nextLabelNumberFor(mergedWallets, get().nextLabelNumber);
    writeWalletIndex(mergedWallets);
    writeNextLabelNumber(nextCounter);

    set({ wallets: mergedWallets, nextLabelNumber: nextCounter });

    const manifestError = await syncManifest(mergedWallets);
    if (manifestError !== null) {
      console.warn(`restoreFromManifestNative: manifest rewrite failed: ${manifestError}`);
    }

    return restored;
  },

  deriveAddressForWallet: async (id) => {
    const entry = get().wallets.find((w) => w.id === id);
    if (!entry) {
      throw new Error(`deriveAddressForWallet: unknown wallet ${id}`);
    }
    const address = await deriveAndCleanupAddress(id, 0, 'Authenticate to derive wallet address');
    const updated: WalletIndexEntry = {
      ...entry,
      accounts: [{ index: 0, address, hidden: false }],
      primaryAccountIndex: 0,
    };
    const nextWallets = get().wallets.map((w) => (w.id === id ? updated : w));
    writeWalletIndex(nextWallets);
    set({ wallets: nextWallets });
    const manifestError = await syncManifest(nextWallets);
    if (manifestError !== null) {
      throw new Error(`Address derived, but manifest could not be updated: ${manifestError}`);
    }
    return updated;
  },

  addAccount: async (walletId, name) => {
    const wallet = get().wallets.find((w) => w.id === walletId);
    if (!wallet) throw new Error(`Unknown wallet ${walletId}`);
    const nextIndex = Math.max(...wallet.accounts.map((account) => account.index), -1) + 1;
    const address = await deriveAndCleanupAddress(
      walletId,
      nextIndex,
      'Authenticate to add a new account',
    );
    const account: WalletAccount = {
      index: nextIndex,
      address,
      name: cleanAccountName(name),
      hidden: false,
    };
    const nextWallets = replaceWallet(get().wallets, walletId, (current) => ({
      ...current,
      accounts: [...current.accounts, account].sort((a, b) => a.index - b.index),
    }));
    writeWalletIndex(nextWallets);
    set({ wallets: nextWallets });
    const manifestError = await syncManifest(nextWallets);
    if (manifestError !== null) {
      throw new Error(`Account added, but manifest could not be updated: ${manifestError}`);
    }
    return account;
  },

  restorePendingAccount: async (walletId, accountIndex) => {
    const wallet = get().wallets.find((w) => w.id === walletId);
    if (!wallet) throw new Error(`Unknown wallet ${walletId}`);
    if (!wallet.pendingAccountIndices?.includes(accountIndex)) {
      throw new Error(`No pending account ${accountIndex} for wallet ${walletId}`);
    }
    const pending = wallet.pendingAccounts?.find((account) => account.index === accountIndex);
    const address = await deriveAndCleanupAddress(
      walletId,
      accountIndex,
      'Authenticate to restore this account',
    );
    const account: WalletAccount = {
      index: accountIndex,
      address,
      name: pending?.name,
      hidden: pending?.hidden === true,
    };
    const nextWallets = replaceWallet(get().wallets, walletId, (current) => {
      const remainingPendingAccounts = current.pendingAccounts?.filter(
        (a) => a.index !== accountIndex,
      );
      const remainingPendingIndices = current.pendingAccountIndices?.filter(
        (idx) => idx !== accountIndex,
      );
      return {
        ...current,
        accounts: [...current.accounts.filter((a) => a.index !== accountIndex), account].sort(
          (a, b) => a.index - b.index,
        ),
        pendingAccountIndices:
          remainingPendingIndices && remainingPendingIndices.length > 0
            ? remainingPendingIndices
            : undefined,
        pendingAccounts:
          remainingPendingAccounts && remainingPendingAccounts.length > 0
            ? remainingPendingAccounts
            : undefined,
      };
    });
    writeWalletIndex(nextWallets);
    set({ wallets: nextWallets });
    const manifestError = await syncManifest(nextWallets);
    if (manifestError !== null) {
      throw new Error(`Account restored, but manifest could not be updated: ${manifestError}`);
    }
    return account;
  },

  setAccountHidden: async (walletId, accountIndex, hidden) => {
    const nextWallets = replaceWallet(get().wallets, walletId, (wallet) => {
      const account = wallet.accounts.find((a) => a.index === accountIndex);
      if (!account) throw new Error(`Unknown account ${accountIndex} for wallet ${walletId}`);
      if (accountIndex === wallet.primaryAccountIndex && hidden) {
        throw new Error('Primary account cannot be hidden');
      }
      return {
        ...wallet,
        accounts: wallet.accounts.map((a) => (a.index === accountIndex ? { ...a, hidden } : a)),
      };
    });
    writeWalletIndex(nextWallets);
    set({ wallets: nextWallets });
    const manifestError = await syncManifest(nextWallets);
    if (manifestError !== null) {
      throw new Error(`Account updated, but manifest could not be updated: ${manifestError}`);
    }
  },

  setAccountName: async (walletId, accountIndex, name) => {
    const cleanName = cleanAccountName(name);
    const nextWallets = replaceWallet(get().wallets, walletId, (wallet) => {
      const account = wallet.accounts.find((a) => a.index === accountIndex);
      if (!account) throw new Error(`Unknown account ${accountIndex} for wallet ${walletId}`);
      return {
        ...wallet,
        accounts: wallet.accounts.map((a) =>
          a.index === accountIndex ? { ...a, name: cleanName } : a,
        ),
      };
    });
    writeWalletIndex(nextWallets);
    set({ wallets: nextWallets });
    const manifestError = await syncManifest(nextWallets);
    if (manifestError !== null) {
      throw new Error(`Account renamed, but manifest could not be updated: ${manifestError}`);
    }
  },

  setPrimaryAccount: async (walletId, accountIndex) => {
    const nextWallets = replaceWallet(get().wallets, walletId, (wallet) => {
      const account = wallet.accounts.find((a) => a.index === accountIndex);
      if (!account) throw new Error(`Unknown account ${accountIndex} for wallet ${walletId}`);
      if (account.hidden) throw new Error('Hidden account cannot be primary');
      return { ...wallet, primaryAccountIndex: accountIndex };
    });
    writeWalletIndex(nextWallets);
    set({ wallets: nextWallets });
    const manifestError = await syncManifest(nextWallets);
    if (manifestError !== null) {
      throw new Error(
        `Primary account updated, but manifest could not be updated: ${manifestError}`,
      );
    }
  },

  deleteWallet: async (id) => {
    const entry = get().wallets.find((w) => w.id === id);
    if (!entry) return;
    await deleteMnemonic(entry.id);
    const nextWallets = get().wallets.filter((w) => w.id !== id);
    writeWalletIndex(nextWallets);
    set({ wallets: nextWallets });

    const manifestError = await syncManifest(nextWallets);
    if (manifestError !== null) {
      throw new Error(
        `Wallet deleted, but iCloud backup manifest could not be updated: ${manifestError}`,
      );
    }
  },

  resetAll: async () => {
    const { wallets, pendingWalletId } = get();
    await Promise.all(wallets.map((w) => deleteMnemonic(w.id)));
    if (pendingWalletId !== null) {
      try {
        await deleteMnemonic(pendingWalletId);
      } catch {
        // best-effort
      }
    }
    writeWalletIndex([]);
    writeNextLabelNumber(1);
    set({
      wallets: [],
      nextLabelNumber: 1,
      pendingWalletId: null,
      pendingIcloudOptIn: false,
    });

    try {
      await deleteManifest();
    } catch (err) {
      console.warn(`resetAll: manifest delete failed: ${String(err)}`);
    }
  },
}));
