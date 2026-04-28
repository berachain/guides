import { createMMKV } from 'react-native-mmkv';
import { isValidEvmAddress } from '../crypto/evm';
import type { WalletAccount, WalletIndexEntry } from '../types';

/**
 * MMKV instance for non-secret wallet metadata (the index).
 *
 * The `encryptionKey` below is NOT a secret — it ships in the JS bundle and is
 * trivially recoverable from a compromised device. It's a belt-and-suspenders
 * XOR/AES layer on top of iOS Data Protection, which is the real security
 * boundary for the on-disk file. Mnemonics themselves never touch MMKV — they
 * live in the iOS Keychain via `./secure.ts`.
 */
export const storage = createMMKV({
  id: 'wallet-app',
  encryptionKey: 'wallet-app-v1',
});

const INDEX_KEY = 'wallet_index';
const NEXT_LABEL_KEY = 'next_label_number';
const INDEX_SCHEMA_VERSION = 3;

interface StoredWalletIndex {
  schemaVersion: 3;
  entries: WalletIndexEntry[];
}

function normalizeAccount(value: unknown, walletId: string): WalletAccount | null {
  if (value === null || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.index !== 'number' || !Number.isInteger(v.index) || typeof v.address !== 'string') {
    return null;
  }
  if (!isValidEvmAddress(v.address)) {
    console.warn(`readWalletIndex: invalid address for wallet ${walletId} account ${v.index}`);
  }
  const name = typeof v.name === 'string' && v.name.trim().length > 0 ? v.name.trim() : undefined;
  return {
    index: v.index,
    address: v.address,
    name,
    hidden: typeof v.hidden === 'boolean' ? v.hidden : false,
  };
}

function migrateV1Entry(value: unknown): WalletIndexEntry | null {
  if (value === null || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.id !== 'string' ||
    typeof v.label !== 'string' ||
    typeof v.createdAt !== 'number' ||
    typeof v.icloudBackedUp !== 'boolean'
  ) {
    return null;
  }
  return {
    id: v.id,
    label: v.label,
    createdAt: v.createdAt,
    icloudBackedUp: v.icloudBackedUp,
    // Lazy Stage 7 migration: address derivation can require biometrics, so
    // reads tolerate missing accounts and UI offers an explicit derive action.
    accounts: [],
    primaryAccountIndex: 0,
  };
}

function normalizeEntry(value: unknown): WalletIndexEntry | null {
  const legacy = migrateV1Entry(value);
  if (legacy === null || value === null || typeof value !== 'object') return legacy;
  const v = value as Record<string, unknown>;
  const accounts = Array.isArray(v.accounts)
    ? v.accounts
        .map((account) => normalizeAccount(account, legacy.id))
        .filter((account): account is WalletAccount => account !== null)
    : [];
  const pendingAccounts = Array.isArray(v.pendingAccounts)
    ? v.pendingAccounts
        .map((account) => normalizeAccount(account, legacy.id))
        .filter((account): account is WalletAccount => account !== null)
    : undefined;
  const pendingAccountIndices = Array.isArray(v.pendingAccountIndices)
    ? v.pendingAccountIndices.filter(
        (idx): idx is number => typeof idx === 'number' && Number.isInteger(idx) && idx >= 0,
      )
    : undefined;

  return {
    ...legacy,
    accounts,
    primaryAccountIndex:
      typeof v.primaryAccountIndex === 'number' && Number.isInteger(v.primaryAccountIndex)
        ? v.primaryAccountIndex
        : 0,
    pendingAccountIndices,
    pendingAccounts,
  };
}

export function readWalletIndex(): WalletIndexEntry[] {
  const raw = storage.getString(INDEX_KEY);
  if (typeof raw !== 'string' || raw.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map(migrateV1Entry).filter((e): e is WalletIndexEntry => e !== null);
    }
    if (parsed === null || typeof parsed !== 'object') return [];
    const stored = parsed as { schemaVersion?: number; entries?: unknown };
    if (
      (stored.schemaVersion !== 2 && stored.schemaVersion !== INDEX_SCHEMA_VERSION) ||
      !Array.isArray(stored.entries)
    ) {
      return [];
    }
    return stored.entries.map(normalizeEntry).filter((e): e is WalletIndexEntry => e !== null);
  } catch {
    return [];
  }
}

export function writeWalletIndex(entries: WalletIndexEntry[]): void {
  storage.set(
    INDEX_KEY,
    JSON.stringify({ schemaVersion: INDEX_SCHEMA_VERSION, entries } satisfies StoredWalletIndex),
  );
}

export function readNextLabelNumber(): number {
  const n = storage.getNumber(NEXT_LABEL_KEY);
  return typeof n === 'number' && Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

export function writeNextLabelNumber(n: number): void {
  storage.set(NEXT_LABEL_KEY, n);
}
