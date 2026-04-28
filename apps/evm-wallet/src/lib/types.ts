export interface WalletAccount {
  index: number;
  address: string;
  name?: string;
  hidden: boolean;
}

export interface WalletIndexEntry {
  id: string;
  label: string;
  createdAt: number;
  icloudBackedUp: boolean;
  accounts: WalletAccount[];
  primaryAccountIndex: number;
  pendingAccountIndices?: number[];
  pendingAccounts?: WalletAccount[];
}

export interface Wallet extends WalletIndexEntry {
  mnemonic: string;
}

/**
 * One entry in the synced iCloud Keychain manifest.
 *
 * Currently identical in shape to `WalletIndexEntry`, kept as its own type so
 * the on-device (MMKV) shape and the synced-to-iCloud shape can evolve
 * independently. For example, the manifest may later gain a `schemaVersion`
 * per entry or sync-side-only fields that the local index doesn't need.
 */
export interface WalletManifestEntry {
  id: string;
  label: string;
  createdAt: number;
  icloudBackedUp: boolean;
  accounts: WalletAccount[];
  primaryAccountIndex: number;
}

/**
 * Synced iCloud Keychain manifest that lists all wallets the user has on any
 * of their devices. Stored as a single Keychain item under
 * `wallet.manifest.v1` with `cloudSync: true` whenever any wallet in the
 * list is synced, otherwise local-only.
 *
 * `schemaVersion` is present from day one so future structural migrations
 * can bump the version and old installs can refuse to read unknown versions
 * rather than corrupt or misinterpret data.
 */
export interface WalletManifest {
  schemaVersion: 3;
  entries: WalletManifestEntry[];
}

export function getAccountDisplayName(account: WalletAccount): string {
  return account.name?.trim() || `Account ${account.index}`;
}

export interface SecurityWarning {
  jailbroken: boolean;
  debugged: boolean;
  hooked: boolean;
}

export interface Network {
  id: string;
  name: string;
  rpcUrl: string;
  chainId: number;
  currencySymbol: string;
  blockExplorerUrl?: string;
  addedAt: number;
}

export interface NetworksState {
  schemaVersion: 1;
  networks: Network[];
  activeNetworkId: string | null;
}
