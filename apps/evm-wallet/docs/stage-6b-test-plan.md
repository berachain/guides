# Stage 6b Test Plan — Secure Enclave wrapping + biometric-gated reveal

Stage 6b adds the Secure Enclave-wrapped encryption model to local-only
wallets. Each local wallet is now stored as:

- `wallet.se.<id>` — Secure Enclave P-256 private key (non-exportable)
- `wallet.aeskey.<id>` — AES-256 data-protection key, ECIES-wrapped with
  the SE public key
- `wallet.mnemonic.<id>` — AES-256-GCM ciphertext of the mnemonic

Reveal requires Face ID / Touch ID / device passcode. iCloud-backed
wallets continue to use the Stage 6 plaintext-with-sync path. Wallets
created before Stage 6b are not migrated; they reveal without a biometric
prompt.

## Prerequisites

1. Rebuild the iOS dev client — both `expo-local-authentication` and the
   new Swift files require a new binary:
   ```bash
   bunx expo prebuild --platform ios --clean
   eas build -p ios --profile development-simulator --local
   # or: bunx expo run:ios
   ```
2. On physical devices, ensure at least one biometric identity is enrolled
   and a device passcode is set. Simulator builds use the plaintext fallback
   below and do not require Face ID enrollment.
3. Delete the app before starting each "fresh install" scenario.

### Simulator caveat

iOS Simulator does not provide real Secure Enclave + Face ID / passcode
enforcement. Simulator builds therefore route the public wallet-crypto module
through plaintext Keychain storage for both local and iCloud-backed wallets.
The onboarding UI remains usable and shows a simulator-mode warning, but any
test step that asserts SE wrapping, a biometric/passcode prompt, or the real
Secure Enclave security boundary must be validated on a physical iPhone.

## 1. Fresh local wallet — SE-wrapped path

1. Fresh install. Tap **Generate Recovery Phrase**.
2. On device, Face ID / Touch ID / passcode sheet appears with copy
   "Authenticate to view your recovery phrase". On simulator, the
   simulator-mode warning is shown and reveal proceeds without a native
   authentication sheet.
3. Authenticate if prompted. 24 English BIP39 words appear.
4. Acknowledge and tap **Continue**.
5. Toggle iCloud **off**. Tap **Finish** → warning screen.
6. Acknowledge → list shows `Mnemonic #1`, no cloud indicator.
7. Force-quit, relaunch. Wallet still present.
8. (Optional, with Keychain inspector on device): verify three Keychain
   entries exist for the wallet id — `wallet.se.<id>`,
   `wallet.aeskey.<id>`, `wallet.mnemonic.<id>` — and that
   `wallet.mnemonic.<id>` is ciphertext (not UTF-8 words). On simulator,
   verify only `wallet.mnemonic.<id>` exists for the local wallet and no
   SE/wrapped-AES artifacts are present.

## 2. Fresh iCloud-backed wallet — plaintext-synced path

1. Fresh install. Tap **Generate Recovery Phrase**.
2. On device, the biometric/passcode sheet appears (the initial write is
   SE-wrapped). Authenticate. On simulator, reveal proceeds without a native
   sheet because the pending wallet is plaintext local.
3. Words appear. Acknowledge and tap **Continue**.
4. Toggle iCloud **on**. Tap **Finish**.
5. A second biometric sheet appears with copy
   "Authenticate to enable iCloud backup for this wallet". Authenticate.
6. Wallet appears in list with ☁️ indicator.
7. (Optional, with Keychain inspector): verify the wallet id has only
   one Keychain entry — `wallet.mnemonic.<id>` with
   `synchronizable: true` — and that the SE key and wrapped-AES items
   are absent.

## 3. Cancel biometric on reveal (device only)

1. Tap **Generate Recovery Phrase**.
2. When the Face ID / Touch ID sheet appears, tap **Cancel**.
3. Reveal screen shows "Authentication canceled" + **Try again** button.
4. Tap **Try again**. Sheet reappears. Authenticate. Words appear.

## 4. Cancel biometric on iCloud toggle (device only)

1. Generate a fresh wallet, continue to confirm screen.
2. Toggle iCloud **on**. Tap **Finish**.
3. Cancel the biometric sheet.
4. Confirm screen shows amber status message:
   "iCloud backup not enabled. Try again, or turn the switch off to
   continue without backup."
5. Tap **Finish** again → sheet reappears → authenticate → wallet is
   saved with iCloud indicator.
6. Alternative: toggle iCloud **off** after cancel → tap **Finish** →
   warning screen → local-only wallet saved (still SE-wrapped on device).

## 5. Biometrics disabled at OS level — generate is blocked on device

1. On a physical device, Settings → Face ID & Passcode → disable Face ID
   for apps.
2. Relaunch app. On the generate screen you should see
   "Face ID required" or "Biometrics required" copy with
   **Open Settings** and a subdued "Continue anyway (uses device
   passcode)" link.
3. If a device passcode is set, **Continue anyway** succeeds — the
   reveal prompt asks for the device passcode instead of Face ID.
4. If no passcode is set, the SE key creation fails with
   `BIOMETRY_UNAVAILABLE` and the user sees the "Biometrics required"
   alert on the generate screen.

Simulator builds skip this biometric preflight block and show the
simulator-mode warning instead.

## 6. Delete SE-wrapped wallet — no biometric prompt

1. From the wallets list, delete a local wallet via the trash icon and typed
   confirmation.
2. No biometric sheet is shown during delete.
3. Force-quit, relaunch. Wallet gone from list.
4. If recorded, verify `WalletCrypto.mnemonicExists(id)` → `false` and
   that all Keychain artifacts for that wallet id are gone.

## 7. Cancel mid-creation — no orphan Keychain entries

Same as the Stage 6 cancel test. On device, the orphan includes SE key and
wrapped AES key; on simulator, it is plaintext-only. Cancel from each of:

- Reveal screen swipe-back / discard
- Confirm screen header-back / discard
- Warning screen swipe-back / discard

In every case, after **Discard**, `WalletCrypto.mnemonicExists(id)` must
return `false` and no `wallet.se.<id>` / `wallet.aeskey.<id>` items
remain. `deleteMnemonic` is best-effort; none of these deletes should
prompt for biometrics.

## 8. iCloud → local mode transition (post-Stage-6b flow)

Manual (requires an existing iCloud-backed wallet):

1. Currently there is no UI for toggling an existing wallet back to
   local. To exercise this path manually, call
   `WalletCrypto.setMnemonicSyncState(id, false)` from a dev console
   (or a temporary dev-only button).
2. On device, no biometric prompt on this path (read plaintext → encrypt
   under fresh SE-wrapped AES). Wallet list still shows the wallet; cloud
   indicator removed after a manifest rewrite.
3. On device, reveal now requires biometrics. On simulator, both modes are
   plaintext and this operation only flips the Keychain sync state.

Note: this path is wired in the native module for completeness but is
not exposed in the UI in Stage 6b.

## 9. iCloud restore after Stage 6b

1. Create one iCloud-backed wallet and one local (SE-wrapped) wallet.
2. Wait ~30s to allow Keychain sync.
3. Delete the app and reinstall.
4. Loading → restore screen lists only the iCloud-backed wallet (the
   local one is not in the iCloud manifest, as expected).
5. **Restore wallets** → navigates to wallets list.
6. Tap reveal for the restored wallet (when implemented) or invoke
   `readMnemonic(id)` — **no biometric prompt** (plaintext path).

## 10. Pre-existing Stage 6 wallet continues to work

This is only testable on an instance that had Stage 6 installed before
Stage 6b. If you have such a build:

1. Upgrade to the Stage 6b dev client.
2. Launch. Existing wallet still appears in list.
3. If the reveal-from-list UI lands later, reveal still works without a
   biometric prompt — it's on the plaintext path and has no wrapped AES
   key, so the native module falls through to `revealPlaintext`.

## 11. XCTest suite

Run the three test files under `modules/wallet-crypto/ios/Tests/`:

- `BIP39Tests` — unchanged from Stage 6.
- `AESEncryptionTests`:
  - round-trip encrypt/decrypt
  - output length is `nonce(12) + plaintext + tag(16)`
  - two encryptions of same plaintext produce different ciphertexts
  - decrypt with wrong key throws
  - malformed ciphertext throws `invalidCiphertext`
  - tampered ciphertext throws (GCM auth failure)
  - `randomKey()` returns 32 bytes, non-deterministic
  - invalid key length (AES-128) throws `invalidKeyLength`
- `SecureEnclaveTests`:
  - availability probe can run
  - create → load → publicKey round-trip when SE is available
  - create → delete → load throws `keyNotFound` when SE is available
  - delete is idempotent
  - wrap → unwrap returns original AES key when SE is available
  - wrap without existing key throws `keyNotFound`
  - end-to-end Stage 6b pipeline for three distinct mnemonics when SE is
    available

**SE tests on simulator/device**: `SecureEnclaveTests` skip SE-touching
cases when DeviceOwnerAuthentication is unavailable. On device,
`unwrapAESKey` may surface a Face ID sheet that XCTest cannot dismiss.
Device validation of the wrap/unwrap pipeline is manual — see sections 1
and 3 above.

## 12. No mnemonic / key logging

During every flow above, run:

```bash
xcrun simctl spawn booted log stream --predicate 'processImagePath contains "walletapp"' | tee stage6b.log
```

Verify `grep -Ei 'mnemonic|entropy|aeskey|secure enclave|wrapped' stage6b.log`
returns no hits originating from this app's code (system log noise that
mentions the keychain service name is acceptable). Also confirm:

```bash
grep -Ei 'abandon|zoo|letter advice|legal winner' stage6b.log
```

returns nothing (known BIP39 words from the test vectors).

## 13. Regression checks — still green from earlier stages

- Force-quit mid-flow on any onboarding screen: returns to generate
  (fresh install) or wallets list (existing).
- Screen capture attempts on reveal: screenshots are blank.
- App switcher snapshot: background overlay covers screen.
- Jailbreak banner: still shown on a compromised simulator.
- DeleteDialog: no keyboard suggestions, no autocorrect.
- Monotonic labels survive mid-list delete.
