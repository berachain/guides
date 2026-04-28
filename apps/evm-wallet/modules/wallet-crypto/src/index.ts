import WalletCrypto from "./WalletCryptoModule";

/**
 * Returns true for simulator builds. This is exposed so JS can label the
 * reduced-security simulator fallback; it is not a runtime security switch.
 */
export function isRunningOnSimulator(): boolean {
  return WalletCrypto.isRunningOnSimulator?.() ?? false;
}

/**
 * Generates fresh 256-bit entropy in Swift, converts to a 24-word BIP39
 * mnemonic, stores it in the iOS Keychain, and returns the new wallet id
 * (UUID string).
 *
 * Storage shape depends on `icloudBackedUp`:
 *   - `true`  → plaintext UTF-8 mnemonic stored with `kSecAttrSynchronizable`.
 *   - `false` → AES-256-GCM ciphertext stored locally; the AES key is
 *               wrapped by a Secure Enclave P-256 public key. Reveal
 *               requires a biometric / passcode prompt.
 *
 * Simulator builds are a development exception: both modes use plaintext
 * Keychain storage because simulator Secure Enclave auth is unreliable.
 *
 * The plaintext mnemonic NEVER crosses the JS bridge from this call. If you
 * need to display it to the user, follow up with `revealMnemonic(id)`.
 */
export async function generateAndStoreMnemonic(
  icloudBackedUp: boolean,
): Promise<string> {
  return WalletCrypto.generateAndStoreMnemonic(icloudBackedUp);
}

/**
 * Reads the stored mnemonic for `id` out of the Keychain and returns it as
 * a plaintext string. This is the ONLY function in the module that crosses
 * secret material across the JS bridge.
 *
 * For Secure-Enclave-wrapped wallets this triggers a biometric prompt
 * (whose text is `prompt`, if provided). For iCloud-backed and pre-Stage-6b
 * local wallets this reads the plaintext directly without prompting.
 * Simulator builds always use the plaintext path.
 *
 * Error codes (thrown as Expo exceptions):
 *   - `E_USER_CANCELED`        — user dismissed the biometric prompt
 *   - `E_CORRUPT_STATE`        — wallet artifacts are mutually inconsistent
 *   - `E_NOT_FOUND`            — no wallet stored for `id`
 *   - `E_KEYCHAIN_READ_FAILED` — underlying Keychain / Security failure
 *
 * The caller must drop the returned string reference as soon as the user
 * leaves the reveal screen.
 */
export async function revealMnemonic(
  id: string,
  prompt?: string,
): Promise<string> {
  return WalletCrypto.revealMnemonic(id, prompt);
}

/**
 * Returns the 64-byte BIP39 seed as lowercase hex. The seed is equivalent to
 * the mnemonic in security terms: derive what you need, drop the string, and
 * never persist or log it.
 */
export async function deriveSeedFromMnemonic(
  id: string,
  prompt: string,
): Promise<string> {
  return WalletCrypto.deriveSeedFromMnemonic(id, prompt);
}

/**
 * Deletes every Keychain artifact associated with `id` — the mnemonic
 * blob (plaintext or ciphertext), the wrapped AES key (if present), and
 * the Secure Enclave private key (if present). Best-effort on each.
 * Idempotent.
 *
 * Does NOT trigger a biometric prompt — `SecItemDelete` and SE key
 * deletion are unauthenticated operations.
 */
export async function deleteMnemonic(id: string): Promise<void> {
  return WalletCrypto.deleteMnemonic(id);
}

/**
 * Cheap existence check that does not return the plaintext mnemonic.
 * Returns `true` if either the mnemonic blob or a wrapped AES key is
 * present for `id`. Safe to call during the iCloud restore flow and in
 * dev-only diagnostics.
 */
export async function mnemonicExists(id: string): Promise<boolean> {
  return WalletCrypto.mnemonicExists(id);
}

/**
 * Switches a wallet between the local (Secure-Enclave-wrapped) and iCloud
 * (plaintext-with-sync) storage modes in place, preserving the mnemonic
 * bytes. Local → iCloud decrypts the mnemonic (biometric prompt) and
 * re-stores it as plaintext+synced. iCloud → local encrypts the
 * mnemonic under a fresh SE-wrapped AES key. Same-mode calls are a no-op.
 * Simulator builds use plaintext for both modes and only rewrite the
 * Keychain sync state.
 *
 * `prompt` is surfaced in the biometric sheet when the local → iCloud
 * transition requires it.
 */
export async function setMnemonicSyncState(
  id: string,
  icloudBackedUp: boolean,
  prompt?: string,
): Promise<void> {
  return WalletCrypto.setMnemonicSyncState(id, icloudBackedUp, prompt);
}

/**
 * Updates the sync state and returns the BIP39 seed hex in one native call.
 * On device this avoids a second biometric prompt for local → iCloud create.
 */
export async function setSyncStateAndDeriveSeed(
  id: string,
  icloudBackedUp: boolean,
  prompt: string,
): Promise<string> {
  return WalletCrypto.setSyncStateAndDeriveSeed(id, icloudBackedUp, prompt);
}
